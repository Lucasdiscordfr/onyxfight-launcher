package fr.onyxfight.carte;

import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Génère d'avance toute la map (terrain 1.8) sur un serveur 1.8.8 temporaire, puis l'arrête.
 * Réglages : rayon.txt (rayon en blocs, 7500 par défaut) et centre.txt (« x z », 0 0 par défaut) dans le dossier du plugin.
 * L'avancée est gardée (avancee.txt) : relancer le serveur reprend là où il s'était arrêté.
 */
public class Generation extends JavaPlugin implements Runnable {
    private static final long BUDGET_NS = 45_000_000L;
    private World monde;
    private int cx0, cz0, largeur;
    private long index, total, dernier = -1, debut, faits;

    private String lire(String nom, String defaut) {
        try {
            return new String(Files.readAllBytes(new File(getDataFolder(), nom).toPath()), StandardCharsets.UTF_8).trim();
        } catch (Exception e) {
            return defaut;
        }
    }

    private void ecrire(String nom, String texte) {
        try {
            getDataFolder().mkdirs();
            Files.write(new File(getDataFolder(), nom).toPath(), texte.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignore) {
        }
    }

    @Override
    public void onEnable() {
        monde = Bukkit.getWorlds().get(0);
        int rayon = Integer.parseInt(lire("rayon.txt", "7500"));
        String[] c = lire("centre.txt", "0 0").split("\\s+");
        int x = Integer.parseInt(c[0]), z = Integer.parseInt(c[1]);
        cx0 = (x - rayon) >> 4;
        cz0 = (z - rayon) >> 4;
        int cx1 = (x + rayon) >> 4, cz1 = (z + rayon) >> 4;
        largeur = cx1 - cx0 + 1;
        total = (long) largeur * (cz1 - cz0 + 1);
        index = Long.parseLong(lire("avancee.txt", "0"));
        debut = System.currentTimeMillis();
        getLogger().info("Génération de " + total + " chunks (" + 2 * rayon + " x " + 2 * rayon + " blocs autour de " + x + " " + z
                + "), reprise à " + index);
        Bukkit.getScheduler().runTaskTimer(this, this, 40L, 1L);
    }

    @Override
    public void run() {
        long fin = System.nanoTime() + BUDGET_NS;
        while (index < total && System.nanoTime() < fin) {
            int cx = cx0 + (int) (index % largeur), cz = cz0 + (int) (index / largeur);
            monde.loadChunk(cx, cz, true);
            if (monde.isChunkLoaded(cx, cz - 2)) {
                monde.unloadChunkRequest(cx, cz - 2); // rangée finie (voisins générés) : on la libère
            }
            index++;
            faits++;
        }
        long pc = index * 1000 / Math.max(1, total);
        if (pc != dernier) {
            dernier = pc;
            ecrire("avancee.txt", String.valueOf(index));
            long ecoule = System.currentTimeMillis() - debut;
            long reste = faits > 0 ? (long) ((total - index) * (ecoule / (double) faits) / 1000) : 0;
            getLogger().info(String.format("%.1f %% (%d / %d) — reste environ %d h %02d min", pc / 10.0, index, total, reste / 3600, reste / 60 % 60));
        }
        if (index >= total) {
            getLogger().info("Map terminée : arrêt du serveur.");
            ecrire("avancee.txt", String.valueOf(index));
            ecrire("TERMINE", "ok");
            Bukkit.getScheduler().cancelTasks(this);
            Bukkit.shutdown();
        }
    }
}
