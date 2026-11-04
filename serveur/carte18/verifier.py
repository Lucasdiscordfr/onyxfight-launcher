#!/usr/bin/env python3
"""
Vérifie la map convertie en 1.21.1 : y a-t-il de vrais blocs sous 0 ? la bedrock est-elle au fond ?
le pack « hauteur 0 à 255 » est-il actif ?

    python3 verifier.py /opt/onyxfight/conversion121/world
"""
import gzip
import io
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fusion as F  # noqa: E402

monde = sys.argv[1] if len(sys.argv) > 1 else '/opt/onyxfight/conversion121/world'

# Pack de hauteur actif ?
_, (t, r) = F.lire_nbt(io.BytesIO(gzip.decompress(open(os.path.join(monde, 'level.dat'), 'rb').read())))
d = r['Data'][1]
packs = d.get('DataPacks', (F.COMPOSE, {}))[1]
actifs = [x for x in packs.get('Enabled', (F.LISTE, (F.TEXTE, [])))[1][1]]
print('Packs actifs :', ', '.join(actifs) or 'aucun')
print('Pack de hauteur actif :', 'OUI' if any('onyxfight-hauteur' in a for a in actifs) else 'NON')


def noms(section):
    bs = section.get('block_states', (F.COMPOSE, {}))[1]
    return [b['Name'][1] for b in bs.get('palette', (F.LISTE, (F.COMPOSE, [])))[1][1]]


regions = [f for f in os.listdir(os.path.join(monde, 'region')) if f.endswith('.mca')]
random.seed(1)
echantillon = random.sample(regions, min(12, len(regions))) + [f for f in ('r.-1.-1.mca', 'r.0.0.mca') if f in regions]
total = sous_zero_pleins = avec_bedrock = 0
exemples = []
for f in echantillon:
    chunks, _ = F.lire_region(os.path.join(monde, 'region', f))
    for donnees in list(chunks.values())[:40]:
        _, (t, c) = F.lire_nbt(io.BytesIO(zlib.decompress(donnees)))
        total += 1
        plein = False
        for s in c.get('sections', (F.LISTE, (F.COMPOSE, [])))[1][1]:
            y = s['Y'][1]
            n = noms(s)
            if y < 0 and any(x not in ('minecraft:air', 'minecraft:cave_air', 'minecraft:void_air') for x in n):
                plein = True
            if y == 0:
                if 'minecraft:bedrock' in n:
                    avec_bedrock += 1
                elif len(exemples) < 3:
                    exemples.append((f, c.get('xPos', (0, '?'))[1], c.get('zPos', (0, '?'))[1], c.get('Status', (0, '?'))[1], n[:6]))
        sous_zero_pleins += plein
print('Chunks regardés :', total)
print('Chunks avec de vrais blocs sous 0 :', sous_zero_pleins)
print('Chunks avec la bedrock en bas (couche 0 à 15) :', avec_bedrock)
for e in exemples:
    print('  Sans bedrock :', e)
