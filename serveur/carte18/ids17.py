#!/usr/bin/env python3
"""
Table des numéros d'objets et de blocs de la map 1.7.10 (FML ItemData du level.dat), pour que le plugin 1.21.1
relise les objets gardés par le plugin 1.7 (hôtel des ventes, coffres…), qui étaient notés par numéro.

    python3 ids17.py <map 1.7.10> <fichier de sortie, ex. plugins/OnyxFight/ids-1.7.txt>

Une ligne par objet : « numéro nom » (ex. « 4105 onyxfight:epee_onyx »). Les objets passent avant les blocs.
"""
import gzip, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fusion import lire_nbt


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    _, (t, racine) = lire_nbt(io.BytesIO(gzip.decompress(open(os.path.join(sys.argv[1], 'level.dat'), 'rb').read())))
    fml = racine.get('FML')
    if not fml:
        print('Pas de table FML dans ce level.dat')
        sys.exit(1)
    objets, blocs = {}, {}
    for e in fml[1]['ItemData'][1][1]:
        k, v = e['K'][1], e['V'][1]
        (objets if k[0] == '\x02' else blocs)[v] = k[1:]
    table = dict(blocs)
    table.update(objets)
    os.makedirs(os.path.dirname(os.path.abspath(sys.argv[2])), exist_ok=True)
    with open(sys.argv[2], 'w') as f:
        for v in sorted(table):
            f.write('%d %s\n' % (v, table[v]))
    print('%d numéros écrits dans %s' % (len(table), sys.argv[2]))


if __name__ == '__main__':
    main()
