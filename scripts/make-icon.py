from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=216, fill='#1e1e2e')
draw.rounded_rectangle((152, 172, 872, 852), radius=96, outline='#cba6f7', width=48)
draw.line([(316, 368), (452, 504), (316, 640)], fill='#cba6f7', width=52, joint='curve')
draw.line([(548, 640), (688, 640)], fill='#cba6f7', width=52)
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(root / 'build' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
