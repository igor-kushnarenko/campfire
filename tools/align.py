# Выравнивание слоёв по референсу: масштаб+сдвиг подбираются шаблонным сопоставлением по альфа-маске.
import cv2, numpy as np, json, shutil, glob, os
from PIL import Image
RAW='/workspace/campfire_layers/raw/layers_from_campfire/'
OUT='/workspace/campfire/public/layers/'; AL='/workspace/campfire_layers/aligned/'
MAP={'6E620ABD-852C-4D65-B277-D0716CABF299 2':'01_sky','9E270D44-9865-4EDC-80F0-3E846388AE5D':'02_moon',
'613E568A-EB5F-4D57-95B0-6E1D1EB03DF1':'03_clouds','DA8F3FCF-AB52-46DF-8FC4-8F150509EA00':'04_mountains',
'../05_far_shore_v2':'05_far_shore','C944D288-9832-456C-A0E0-45FA01B8E8DE':'06_lake',
'E0E53216-D01C-4B8E-8283-D50BBB242A2F':'07_forest_mid','3EF738D4-747F-4F6F-BFB3-9EA2DF0C8F04':'08_ground',
'AAC54997-F4ED-4D59-AD8D-B8D4280DD7BF':'09_tree','6551349D-AE65-4148-A6FF-009C5455ACC2':'10_lantern',
'554B83D3-5BEC-42E6-9EB3-8B0BE8F836F7':'11_firering','4FB2EB89-9DE1-46B3-B3AA-6E926BEE84D8':'12_fire_logs',
'4D544BA4-FA29-4917-B6C5-70FBD2EE2FB5':'13_woodpile','F2FEE8C5-4BBD-4696-B8F9-3F93F3A4DF6E':'14_stump_axe',
'FA19E617-994D-4C18-975A-4E54381F3596':'15_camp_left','E9171717-1B1C-43D0-B0AE-F07EEC0FA19E':'16_foreground'}
W,H=1672,941; S=0.5
# широкие фоновые слои без явных деталей: ограничиваем масштаб, иначе корреляция выбирает вырожденный мелкий масштаб
# слои, где автоматика ошибается: (масштаб, dx, dy) задано вручную по наложению
MANUAL={'03_clouds':(0.9,60,-110),'06_lake':(1.0,0,0),'07_forest_mid':(1.0,0,0)}
RANGE={'03_clouds':(0.85,1.16),'06_lake':(0.85,1.16),'07_forest_mid':(0.8,1.2),'10_lantern':(0.45,0.85)}
ref=np.array(Image.open('/workspace/campfire_layers/reference.png').convert('RGB'))
def feat(rgb):  # контуры устойчивее к тёплой подсветке в референсе
    g=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(np.float32)
    g=cv2.GaussianBlur(g,(0,0),1.5)
    return cv2.magnitude(cv2.Sobel(g,cv2.CV_32F,1,0),cv2.Sobel(g,cv2.CV_32F,0,1))
refs=cv2.resize(ref,(int(W*S),int(H*S)),interpolation=cv2.INTER_AREA); rf=feat(refs)
report={}
for uid,name in MAP.items():
    src=RAW+uid+('.png' if uid.startswith('..') else '.PNG'); shutil.copy(src,OUT+name+'.png')
    im=np.array(Image.open(src).convert('RGBA').resize((W,H),Image.LANCZOS))
    if name=='01_sky':
        Image.fromarray(im).save(AL+name+'.png'); report[name]=dict(scale=1,dx=0,dy=0,score=None); continue
    # чистка почти-прозрачного мусора по краям
    im[...,3]=np.where(im[...,3]<12,0,im[...,3])
    ys,xs=np.where(im[...,3]>0); x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
    crop=im[y0:y1,x0:x1]; best=(-9,)
    if name in MANUAL:
        sc,ddx,ddy=MANUAL[name]; best=(0,sc,x0+ddx,y0+ddy,float('nan')); lo=hi=0
    else: lo,hi=RANGE.get(name,(0.35,1.45))
    for sc in np.arange(lo,hi,0.02):
        tw,th=int((x1-x0)*sc*S),int((y1-y0)*sc*S)
        if tw<8 or th<8: continue
        if tw>rf.shape[1] or th>rf.shape[0]:
            continue
        t=cv2.resize(crop,(tw,th),interpolation=cv2.INTER_AREA)
        m=(t[...,3]>128).astype(np.float32); m=cv2.erode(m,np.ones((3,3)))
        if m.sum()<30: continue
        r=cv2.matchTemplate(rf,feat(np.ascontiguousarray(t[...,:3])),cv2.TM_CCORR_NORMED,mask=m)
        r=np.nan_to_num(r,nan=-9,posinf=-9)
        # штраф за уход далеко от исходного места
        cy,cx=np.mgrid[0:r.shape[0],0:r.shape[1]]
        d=np.hypot(cx/S-x0*1-(x1-x0)*(1-sc)/2, cy/S-y0-(y1-y0)*(1-sc)/2)
        r2=r-0.00015*d
        i=np.unravel_index(np.argmax(r2),r.shape)
        if r2[i]>best[0]: best=(r2[i],sc,i[1]/S,i[0]/S,r[i])
    _,sc,px,py,raw=best
    tw,th=int(round((x1-x0)*sc)),int(round((y1-y0)*sc))
    t=cv2.resize(crop,(tw,th),interpolation=cv2.INTER_LANCZOS4 if sc>1 else cv2.INTER_AREA)
    out=np.zeros((H,W,4),np.uint8); px,py=int(px),int(py)
    ax0,ay0=max(px,0),max(py,0); ax1,ay1=min(px+tw,W),min(py+th,H)
    out[ay0:ay1,ax0:ax1]=t[ay0-py:ay1-py,ax0-px:ax1-px]
    Image.fromarray(out).save(AL+name+'.png')
    report[name]=dict(scale=round(float(sc),3),dx=int(px-x0),dy=int(py-y0),score=round(float(raw),3),bbox=[int(x0),int(y0),int(x1),int(y1)])
    print(name,report[name],flush=True)
json.dump(report,open(AL+'align_report.json','w'),indent=1)
# композит и сравнение
comp=Image.new('RGBA',(W,H))
for n in sorted(report): comp.alpha_composite(Image.open(AL+n+'.png').convert('RGBA'))
comp.save('/workspace/campfire_layers/composite_preview.png')
sbs=Image.new('RGB',(W*2,H)); sbs.paste(comp.convert('RGB'),(0,0)); sbs.paste(Image.fromarray(ref),(W,0)); sbs.save('/workspace/campfire_layers/side_by_side.png')
bl=Image.blend(comp.convert('RGB'),Image.fromarray(ref),0.5); bl.save('/workspace/campfire_layers/overlay_50.png')
# уменьшенные копии для рантайма (экономия видеопамяти на ТВ)
os.makedirs('/workspace/campfire/public/layers/half',exist_ok=True)
for n in sorted(report):
    Image.open(AL+n+'.png').resize((W//2,(H+1)//2),Image.LANCZOS).save('/workspace/campfire/public/layers/half/'+n+'.png',optimize=True)

# --- заполнение краёв: слои, которые должны доходить до края кадра, «дотягиваем» повторением крайнего пикселя
EDGE_LAYERS = ['08_ground']  # остальное у края закрывает кадрирование камеры (18 px)
def edge_fill(name, margin=40):
    a = np.array(Image.open(AL + name + '.png').convert('RGBA'))
    al = a[..., 3]
    for y in range(H):
        xs = np.where(al[y] > 128)[0]
        if len(xs) == 0: continue
        if xs[0] < margin: a[y, :xs[0]] = a[y, xs[0]]
        if xs[-1] > W - 1 - margin: a[y, xs[-1] + 1:] = a[y, xs[-1]]
    Image.fromarray(a).save(AL + name + '.png')
for n in EDGE_LAYERS: edge_fill(n, 20)
comp = Image.new('RGBA', (W, H))
for n in sorted(report):
    if n == '03_clouds': continue  # облака теперь процедурные
    comp.alpha_composite(Image.open(AL + n + '.png').convert('RGBA'))
comp.save('/workspace/campfire_layers/composite_preview.png')
sbs = Image.new('RGB', (W * 2, H)); sbs.paste(comp.convert('RGB'), (0, 0)); sbs.paste(Image.fromarray(ref), (W, 0)); sbs.save('/workspace/campfire_layers/side_by_side.png')
for n in sorted(report):
    Image.open(AL + n + '.png').resize((W // 2, (H + 1) // 2), Image.LANCZOS).save('/workspace/campfire/public/layers/half/' + n + '.png', optimize=True)

# озеро — плоская вода: закрываем все дыры в строках ниже горизонта (сквозь них просвечивало небо)
a = np.array(Image.open(AL + '06_lake.png').convert('RGBA'))
shore_a = np.array(Image.open(AL + '05_far_shore.png'))[..., 3]
for y in range(440, H):
    m = a[y, :, 3] > 128
    if m.sum() < 10:
        if y > 0: a[y] = a[y - 1]
        continue
    xs = np.arange(W); idx = np.interp(xs, xs[m], xs[m]).astype(int)
    near = np.where(m, xs, -1)
    # ближайший непрозрачный пиксель слева/справа
    left = np.maximum.accumulate(near); right = np.where(m, xs, W * 2)[::-1]; right = np.minimum.accumulate(right)[::-1]
    pick = np.where(left >= 0, left, right)
    pick = np.where((right < W) & ((left < 0) | (right - xs < xs - left)), right, pick)
    fill = (~m) & (shore_a[y] < 128); a[y, fill, :3] = a[y, pick[fill], :3]; a[y, fill, 3] = 255
Image.fromarray(a).save(AL + '06_lake.png')
Image.open(AL + '06_lake.png').resize((W // 2, (H + 1) // 2), Image.LANCZOS).save('/workspace/campfire/public/layers/half/06_lake.png', optimize=True)
comp = Image.new('RGBA', (W, H))
for n in sorted(report):
    if n == '03_clouds': continue
    comp.alpha_composite(Image.open(AL + n + '.png').convert('RGBA'))
comp.save('/workspace/campfire_layers/composite_preview.png')
sbs = Image.new('RGB', (W * 2, H)); sbs.paste(comp.convert('RGB'), (0, 0)); sbs.paste(Image.fromarray(ref), (W, 0)); sbs.save('/workspace/campfire_layers/side_by_side.png')

# ветки поленницы не должны лезть поверх камней кострища: стираем пиксели поленницы там, где есть камни
ring_a = np.array(Image.open(AL + '11_firering.png'))[..., 3]
wp = np.array(Image.open(AL + '13_woodpile.png').convert('RGBA'))
mask = cv2.dilate((ring_a > 100).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
wp[mask, 3] = 0
Image.fromarray(wp).save(AL + '13_woodpile.png')
Image.fromarray(wp).resize((W // 2, (H + 1) // 2), Image.LANCZOS).save('/workspace/campfire/public/layers/half/13_woodpile.png', optimize=True)
comp = Image.new('RGBA', (W, H))
for n in sorted(report):
    if n == '03_clouds': continue
    comp.alpha_composite(Image.open(AL + n + '.png').convert('RGBA'))
comp.save('/workspace/campfire_layers/composite_preview.png')
sbs = Image.new('RGB', (W * 2, H)); sbs.paste(comp.convert('RGB'), (0, 0)); sbs.paste(Image.fromarray(ref), (W, 0)); sbs.save('/workspace/campfire_layers/side_by_side.png')
