# Нарезка спрайт-листа дров (3x4) и отделение топора от пня.
import numpy as np, cv2, json
from PIL import Image
SHEET = '/workspace/campfire_layers/raw/logs_sheet.png'
OUT = '/workspace/campfire/public/logs/'
NAMES = [['birch_thin', 'birch_medium', 'birch_thick', 'birch_split'],
         ['oak_thin', 'oak_medium', 'oak_thick', 'oak_split'],
         ['pine_medium', 'pine_thick', 'kindling', 'twigs']]
SCALE = 0.5  # подгонка под размер поленьев в поленнице сцены (мир = пиксели референса)
im = np.array(Image.open(SHEET).convert('RGBA')).astype(np.float32)
H, W = im.shape[:2]
# если фон белый и непрозрачный — вырезаем его мягко по «белизне»
rgb, a = im[..., :3], im[..., 3]
white = np.clip((rgb.min(axis=2) - 225) / 25, 0, 1) * (1 - np.clip((rgb.max(axis=2) - rgb.min(axis=2)) / 20, 0, 1))
a = np.minimum(a, 255 * (1 - white))
im[..., 3] = a
meta = {}
for r, row in enumerate(NAMES):
    for c, name in enumerate(row):
        cell = im[r * H // 3:(r + 1) * H // 3, c * W // 4:(c + 1) * W // 4]
        al = cell[..., 3]; ys, xs = np.where(al > 8)
        cell = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        img = Image.fromarray(cell.astype(np.uint8))
        img = img.resize((max(1, round(img.width * SCALE)), max(1, round(img.height * SCALE))), Image.LANCZOS)
        # ночной свет: чуть темнее и холоднее (основное освещение — в шейдере)
        arr = np.array(img).astype(np.float32)
        arr[..., :3] *= np.array([0.9, 0.92, 1.0])
        Image.fromarray(arr.clip(0, 255).astype(np.uint8)).save(OUT + name + '.png')
        meta[name] = [img.width, img.height]
json.dump(meta, open(OUT + 'sizes.json', 'w'))
print(meta)

# --- топор отдельно от пня
L = '/workspace/campfire/public/layers/aligned/14_stump_axe.png'
src = np.array(Image.open('/workspace/campfire_layers/aligned/14_stump_axe.png').convert('RGBA'))
yy, xx = np.mgrid[0:src.shape[0], 0:src.shape[1]]
r_, g_, b_ = [src[..., i].astype(int) for i in range(3)]
metal = (r_ - b_ < 40)
axe = (src[..., 3] > 0) & ((yy < 733) | ((yy < 760) & metal & (xx > 1388) & (xx < 1448)))
axe_img = np.zeros_like(src); axe_img[axe] = src[axe]
ys, xs = np.where(axe); bb = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
Image.fromarray(axe_img[bb[1]:bb[3], bb[0]:bb[2]]).save('/workspace/campfire/public/props/axe.png')
stump = src.copy(); stump[axe] = 0
# дырку на верхнем срезе пня закрашиваем по соседям
hole = (axe & (yy >= 733)).astype(np.uint8)
inner = cv2.dilate(hole, np.ones((5, 5), np.uint8))
rgb = cv2.inpaint(np.ascontiguousarray(src[..., :3]), hole * 255, 4, cv2.INPAINT_TELEA)
stump[hole > 0, :3] = (rgb[hole > 0] * 0.35 + np.array([70, 45, 30]) * 0.65).astype(np.uint8); stump[hole > 0, 3] = 255  # тёмная зарубка
Image.fromarray(stump).save('/workspace/campfire/public/layers/aligned/14_stump.png')
Image.fromarray(stump).resize((src.shape[1] // 2, (src.shape[0] + 1) // 2), Image.LANCZOS).save('/workspace/campfire/public/layers/half/14_stump.png')
json.dump({'axe_bbox': bb}, open('/workspace/campfire/public/props/axe.json', 'w'))
print('axe bbox', bb)
