# Ramène un monde 1.21.4 en 1.21.1 : version des tronçons et blocs qui n'existent pas encore en 1.21.1 remplacés
import os, sys, zlib, struct, io
import nbtlib
from nbtlib import Int, String
from concurrent.futures import ProcessPoolExecutor
CIBLE = 3955
REMPLACE = {'pale_oak_': 'birch_', 'stripped_pale_oak_log': 'stripped_birch_log', 'potted_pale_oak_sapling': 'potted_birch_sapling',
            'resin_brick_slab': 'red_sandstone_slab', 'resin_brick_stairs': 'red_sandstone_stairs', 'resin_bricks': 'smooth_red_sandstone',
            'resin_brick_wall': 'red_sandstone_wall', 'chiseled_resin_bricks': 'chiseled_red_sandstone', 'resin_block': 'orange_terracotta',
            'resin_clump': 'air', 'pale_moss_block': 'moss_block', 'pale_moss_carpet': 'moss_carpet', 'pale_hanging_moss': 'air',
            'creaking_heart': 'stripped_birch_log', 'open_eyeblossom': 'poppy', 'closed_eyeblossom': 'poppy'}
def nom(n):
    if not n.startswith('minecraft:'): return n
    b = n[10:]
    for k in sorted(REMPLACE, key=len, reverse=True):
        if b == k or (k.endswith('_') and b.startswith(k)):
            return 'minecraft:' + (REMPLACE[k] + b[len(k):] if k.endswith('_') else REMPLACE[k])
    return n
def fichier(p):
    data = bytearray(open(p, 'rb').read())
    if len(data) < 8192: return 0
    sortie = bytearray(data[:8192]); sortie[0:4096] = bytes(4096); pos = 2; n = 0
    for i in range(1024):
        off = int.from_bytes(data[i*4:i*4+3], 'big')
        if not off: continue
        ln = struct.unpack('>I', data[off*4096:off*4096+4])[0]; comp = data[off*4096+4]
        raw = bytes(data[off*4096+5:off*4096+4+ln])
        try:
            f = nbtlib.File.parse(io.BytesIO(zlib.decompress(raw) if comp == 2 else raw))
        except Exception:
            continue
        f['DataVersion'] = Int(CIBLE)
        for s in f.get('sections', []):
            for q in s.get('block_states', {}).get('palette', []):
                q['Name'] = String(nom(str(q['Name'])))
                if str(q['Name']) == 'minecraft:air' and 'Properties' in q: del q['Properties']
        b = io.BytesIO(); f.write(b); z = zlib.compress(b.getvalue())
        bloc = struct.pack('>I', len(z) + 1) + b'\x02' + z
        secteurs = (len(bloc) + 4095) // 4096
        sortie[i*4:i*4+4] = pos.to_bytes(3, 'big') + bytes([min(255, secteurs)])
        sortie += bloc + bytes(secteurs * 4096 - len(bloc)); pos += secteurs; n += 1
    open(p, 'wb').write(bytes(sortie))
    return n
if __name__ == '__main__':
    fs = [os.path.join(r, x) for d in sys.argv[1:] for r, _, xs in os.walk(d) for x in xs if x.endswith('.mca')]
    with ProcessPoolExecutor(8) as ex:
        print(sum(ex.map(fichier, fs)), 'tronçons convertis dans', len(fs), 'fichiers')
