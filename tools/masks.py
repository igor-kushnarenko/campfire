from PIL import Image, ImageFilter, ImageDraw
import numpy as np
W,H=480,270
src=Image.open('public/art/reference.png').convert('RGB')
base=src.resize((W,H),Image.BOX); base.save('public/art/base.png')
a=np.asarray(base).astype(int); r,g,b=a[...,0],a[...,1],a[...,2]
yy,xx=np.mgrid[0:H,0:W]; s=W/819
blue=(b>r+12)&(b>=g)
sky=blue&(yy<H*0.30)&(xx>W*0.20)&~((xx<W*0.62)&(yy<H*0.07))
sky|=(yy<H*0.30)&(xx>W*0.25)&(r+g+b>500)&(yy<H*0.25)  # stars/moon area
sky&=~((xx<W*0.58)&(yy<H*0.25)&(r>b))  # branches
def save(m,n,blur=1):
    im=Image.fromarray((m*255).astype('uint8'),'L')
    if blur: im=im.filter(ImageFilter.GaussianBlur(blur))
    im.save(f'public/art/masks/{n}.png')
save(sky,'sky',0.6)
water=blue&(yy>H*0.43)&(yy<H*0.74)&(xx>W*0.36)
water|=(yy>H*0.47)&(yy<H*0.70)&(xx>W*0.78)&(r+g+b>380)
save(water,'water',0.6)
def radial(cx,cy,rx,ry,p=1.5):
    d=np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2); return np.clip(1-d,0,1)**p
save(radial(395*s,372*s,55*s,22*s,0.7),'fire',1)
save(radial(185*s,143*s,140*s,140*s,1.6),'lantern',2)
save(radial(395*s,370*s,330*s,230*s,1.3),'firelight',2)
print('ok')
