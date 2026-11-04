#!/usr/bin/env python3
"""
Recolle la map actuelle (1.7.10, avec ses constructions) dans la nouvelle map générée en 1.8, chunk par chunk.

Les blocs du mod OnyxFight (eau de décor, minerais, coffres…) ne survivraient pas au passage en 1.21 : ils sont
retirés des chunks recopiés et notés dans un fichier (position, nom, valeur) pour être remis par le mod 1.21.1.
Les objets du mod dans les coffres et les créatures du mod sont retirés aussi.

    python3 fusion.py <map 1.7.10> <map 1.8> <blocs-du-mod.txt>

Copie de travail conseillée : la map 1.8 est modifiée sur place.
"""
import gzip
import io
import os
import struct
import sys
import zlib

# ---------- NBT ----------
FIN, OCTET, COURT, ENTIER, LONG, FLOTTANT, DOUBLE, OCTETS, TEXTE, LISTE, COMPOSE, ENTIERS, LONGS = range(13)


def lire_nbt(f):
    t = f.read(1)[0]
    nom = lire_texte(f)
    return nom, (t, lire_valeur(f, t))


def lire_texte(f):
    (n,) = struct.unpack('>H', f.read(2))
    return f.read(n).decode('utf-8', 'surrogateescape')


def lire_valeur(f, t):
    if t == OCTET:
        return struct.unpack('>b', f.read(1))[0]
    if t == COURT:
        return struct.unpack('>h', f.read(2))[0]
    if t == ENTIER:
        return struct.unpack('>i', f.read(4))[0]
    if t == LONG:
        return struct.unpack('>q', f.read(8))[0]
    if t == FLOTTANT:
        return struct.unpack('>f', f.read(4))[0]
    if t == DOUBLE:
        return struct.unpack('>d', f.read(8))[0]
    if t == OCTETS:
        (n,) = struct.unpack('>i', f.read(4))
        return bytearray(f.read(n))
    if t == TEXTE:
        return lire_texte(f)
    if t == LISTE:
        st = f.read(1)[0]
        (n,) = struct.unpack('>i', f.read(4))
        return (st, [lire_valeur(f, st) for _ in range(n)])
    if t == COMPOSE:
        d = {}
        while True:
            st = f.read(1)[0]
            if st == FIN:
                return d
            k = lire_texte(f)
            d[k] = (st, lire_valeur(f, st))
    if t == ENTIERS:
        (n,) = struct.unpack('>i', f.read(4))
        return list(struct.unpack('>%di' % n, f.read(4 * n)))
    if t == LONGS:
        (n,) = struct.unpack('>i', f.read(4))
        return list(struct.unpack('>%dq' % n, f.read(8 * n)))
    raise ValueError('type NBT %d' % t)


def ecrire_texte(f, s):
    b = s.encode('utf-8', 'surrogateescape')
    f.write(struct.pack('>H', len(b)))
    f.write(b)


def ecrire_valeur(f, t, v):
    if t == OCTET:
        f.write(struct.pack('>b', v))
    elif t == COURT:
        f.write(struct.pack('>h', v))
    elif t == ENTIER:
        f.write(struct.pack('>i', v))
    elif t == LONG:
        f.write(struct.pack('>q', v))
    elif t == FLOTTANT:
        f.write(struct.pack('>f', v))
    elif t == DOUBLE:
        f.write(struct.pack('>d', v))
    elif t == OCTETS:
        f.write(struct.pack('>i', len(v)))
        f.write(bytes(v))
    elif t == TEXTE:
        ecrire_texte(f, v)
    elif t == LISTE:
        st, l = v
        f.write(bytes([st]))
        f.write(struct.pack('>i', len(l)))
        for x in l:
            ecrire_valeur(f, st, x)
    elif t == COMPOSE:
        for k, (st, x) in v.items():
            f.write(bytes([st]))
            ecrire_texte(f, k)
            ecrire_valeur(f, st, x)
        f.write(bytes([FIN]))
    elif t == ENTIERS:
        f.write(struct.pack('>i', len(v)))
        f.write(struct.pack('>%di' % len(v), *v))
    elif t == LONGS:
        f.write(struct.pack('>i', len(v)))
        f.write(struct.pack('>%dq' % len(v), *v))


def nbt_octets(nom, racine):
    f = io.BytesIO()
    f.write(bytes([racine[0]]))
    ecrire_texte(f, nom)
    ecrire_valeur(f, racine[0], racine[1])
    return f.getvalue()


# ---------- Fichiers de région ----------
def lire_region(chemin):
    """{(x, z) local: octets compressés (zlib)} ; horodatages."""
    chunks, dates = {}, {}
    if not os.path.exists(chemin):
        return chunks, dates
    d = open(chemin, 'rb').read()
    if len(d) < 8192:
        return chunks, dates
    for i in range(1024):
        loc = struct.unpack('>I', d[i * 4:i * 4 + 4])[0]
        off, n = loc >> 8, loc & 0xFF
        if off == 0:
            continue
        (taille,) = struct.unpack('>I', d[off * 4096:off * 4096 + 4])
        comp = d[off * 4096 + 4]
        donnees = d[off * 4096 + 5:off * 4096 + 4 + taille]
        if comp == 1:
            donnees = zlib.compress(gzip.decompress(donnees))
        chunks[(i % 32, i // 32)] = donnees
        dates[(i % 32, i // 32)] = struct.unpack('>I', d[4096 + i * 4:4096 + i * 4 + 4])[0]
    return chunks, dates


def ecrire_region(chemin, chunks, dates):
    entete, horo, corps = bytearray(4096), bytearray(4096), bytearray()
    secteur = 2
    for (x, z), donnees in sorted(chunks.items()):
        i = x + z * 32
        bloc = struct.pack('>I', len(donnees) + 1) + b'\x02' + donnees
        n = (len(bloc) + 4095) // 4096
        bloc += b'\x00' * (n * 4096 - len(bloc))
        entete[i * 4:i * 4 + 4] = struct.pack('>I', (secteur << 8) | n)
        horo[i * 4:i * 4 + 4] = struct.pack('>I', dates.get((x, z), 0))
        corps += bloc
        secteur += n
    tmp = chemin + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(entete)
        f.write(horo)
        f.write(corps)
    os.replace(tmp, chemin)


# ---------- Correspondance des numéros de blocs et d'objets (FML) ----------
def lire_fml(level_dat):
    _, (t, racine) = lire_nbt(io.BytesIO(gzip.decompress(open(level_dat, 'rb').read())))
    blocs, objets = {}, set()
    fml = racine.get('FML')
    if not fml:
        return blocs, objets
    st, liste = fml[1]['ItemData'][1]
    for e in liste:
        k, v = e['K'][1], e['V'][1]
        nom = k[1:]
        if nom.startswith('minecraft:'):
            continue
        if k[0] == '\x01':
            blocs[v] = nom
        objets.add(v)  # un bloc a aussi son objet, de même numéro
    return blocs, objets


# ---------- Nettoyage d'un chunk ----------
def nettoyer_objets(v, objets_mod):
    """Retire, partout dans l'arbre NBT, les objets dont le numéro est celui d'un objet du mod."""
    t, x = v
    if t == COMPOSE:
        for k in list(x):
            nettoyer_objets(x[k], objets_mod)
    elif t == LISTE:
        st, l = x
        if st == COMPOSE:
            garde = []
            for e in l:
                ident = e.get('id')
                if ident and ident[0] == COURT and 'Count' in e and ident[1] in objets_mod:
                    continue
                nettoyer_objets((COMPOSE, e), objets_mod)
                garde.append(e)
            l[:] = garde


def traiter_chunk(donnees, blocs_mod, objets_mod, sortie):
    nom, (t, racine) = lire_nbt(io.BytesIO(zlib.decompress(donnees)))
    niveau = racine['Level'][1]
    cx, cz = niveau['xPos'][1], niveau['zPos'][1]
    retires = 0
    bas = {i & 0xFF for i in blocs_mod}
    for section in niveau.get('Sections', (LISTE, (COMPOSE, [])))[1][1]:
        y0 = section['Y'][1] * 16
        b = section['Blocks'][1]
        ajout = section.get('Add', (OCTETS, None))[1]
        dat = section['Data'][1]
        if not bas.intersection(set(b)) and not ajout:
            continue
        for i in range(4096):
            n = b[i]
            if ajout:
                a = ajout[i >> 1]
                n |= ((a >> 4) if i & 1 else (a & 0x0F)) << 8
            if n not in blocs_mod:
                continue
            d = dat[i >> 1]
            meta = (d >> 4) if i & 1 else (d & 0x0F)
            x, z, y = i & 15, (i >> 4) & 15, i >> 8
            sortie.write('%d %d %d %s %d\n' % (cx * 16 + x, y0 + y, cz * 16 + z, blocs_mod[n], meta))
            b[i] = 0
            if ajout:
                ajout[i >> 1] &= 0x0F if i & 1 else 0xF0
            dat[i >> 1] &= 0x0F if i & 1 else 0xF0
            retires += 1
    # Fond de bedrock : la couche 0 de la map recollée (une map de spawn n'en a pas toujours)
    for section in niveau.get('Sections', (LISTE, (COMPOSE, [])))[1][1]:
        if section['Y'][1] == 0:
            b = section['Blocks'][1]
            ajout = section.get('Add', (OCTETS, None))[1]
            dat = section['Data'][1]
            for i in range(256):
                b[i] = 7
                if ajout:
                    ajout[i >> 1] &= 0x0F if i & 1 else 0xF0
                dat[i >> 1] &= 0x0F if i & 1 else 0xF0
        # Blocs spéciaux du mod (coffres…) et créatures du mod
    for cle in ('TileEntities', 'Entities'):
        if cle in niveau:
            st, l = niveau[cle][1]
            l[:] = [e for e in l if not ('id' in e and e['id'][0] == TEXTE and ('.' in e['id'][1] or e['id'][1].startswith('onyxfight')))]
    nettoyer_objets((COMPOSE, racine), objets_mod)
    return zlib.compress(nbt_octets(nom, (t, racine))), retires


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    ancien, nouveau, fichier = sys.argv[1:]
    blocs_mod, objets_mod = lire_fml(os.path.join(ancien, 'level.dat'))
    print('Blocs du mod :', ', '.join(sorted(set(blocs_mod.values()))) or 'aucun')
    total_chunks = total_blocs = 0
    with open(fichier, 'w') as sortie:
        dossier = os.path.join(ancien, 'region')
        for nomf in sorted(os.listdir(dossier)):
            if not nomf.endswith('.mca'):
                continue
            chunks, dates = lire_region(os.path.join(dossier, nomf))
            if not chunks:
                continue
            cible = os.path.join(nouveau, 'region', nomf)
            nchunks, ndates = lire_region(cible)
            for pos, donnees in chunks.items():
                propre, n = traiter_chunk(donnees, blocs_mod, objets_mod, sortie)
                nchunks[pos] = propre
                ndates[pos] = dates.get(pos, 0)
                total_chunks += 1
                total_blocs += n
            os.makedirs(os.path.dirname(cible), exist_ok=True)
            ecrire_region(cible, nchunks, ndates)
            print('%s : %d chunks recollés' % (nomf, len(chunks)))
    print('Terminé : %d chunks recollés, %d blocs du mod notés dans %s' % (total_chunks, total_blocs, fichier))


if __name__ == '__main__':
    main()
