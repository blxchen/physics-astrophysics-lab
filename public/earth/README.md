# Earth texture provenance

`blue-marble-relief-{2,4,8}k.jpg` are complete equirectangular images from NASA GIBS, layer `BlueMarble_ShadedRelief`, downloaded on 2026-10-06. Sizes are 2048×1024, 4096×2048, and 8192×4096. The source WMS endpoint is:

`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`

Request parameters: `SERVICE=WMS`, `REQUEST=GetMap`, `VERSION=1.3.0`, `LAYERS=BlueMarble_ShadedRelief`, `STYLES=`, `FORMAT=image/jpeg`, `CRS=EPSG:4326`, `BBOX=-90,-180,90,180`, with each image's width and height above.

These are static NASA imagery assets. The animated clouds and wind over them are PAL model visualizations.
