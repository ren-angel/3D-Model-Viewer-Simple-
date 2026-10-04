# 3D model viewer

A small, fast viewer for FBX and OBJ models (with TGA/PNG/JPG textures), built with Vite and three.js and hosted on GitHub Pages.

## Adding and changing models

Each model is a tab on the page. Only the first one loads when the page
opens; the others load the first time someone clicks their tab.

1. Put the model's files in `public/assets/`. For extra models, use a folder
   per model (e.g. `public/assets/model2/`) so texture names can't clash.
2. Add the model to `public/assets/viewer.json`.
3. Commit and push. GitHub builds and publishes the site in a minute or two.

Supported formats:

- **FBX** (`.fbx`) with its textures.
- **OBJ** (`.obj`) with its **MTL** file (`.mtl`) and textures. The MTL is a
  small text file that tells the OBJ which texture goes on which part. Put it
  in the same folder as the OBJ; the viewer finds it automatically.

Textures are matched **by name only**: the viewer ignores the folders and the
extension written inside the model. If the model asks for `0.dds` (Noesis does
this), the viewer uses `0.tga`, `0.png`, `0.jpg` or `0.webp`, whichever is in
the model's folder. Upper/lower case doesn't matter. If something can't be
found, the page lists the missing names.

Each tab has its own link, e.g. `https://<user>.github.io/<repo>/#second-model`,
which opens that model directly.

### viewer.json

```json
{
  "models": [
    { "title": "Zidane", "file": "Zidane.fbx", "alpha": { "26": "cutout" } },
    { "title": "Second model", "folder": "model2", "file": "model.obj" }
  ],
  "version": "2",
  "autoRotate": true,
  "playAnimation": true,
  "background": ""
}
```

For each model:

| Field         | What it does                                                          |
| ------------- | --------------------------------------------------------------------- |
| `title`       | Name on the tab and page                                              |
| `description` | Optional line of text under the title                                 |
| `file`        | The `.fbx` or `.obj` file                                             |
| `folder`      | Folder inside `public/assets/`; leave out if the files are directly in it |
| `mtl`         | Only if the OBJ doesn't name its MTL file itself                      |
| `alpha`       | Textures whose transparency should be used, e.g. `{ "26": "cutout" }`. `cutout` = hard-edged (hair, eyelashes); `blend` = semi-transparent (glass, gloss). Leave other textures out: in many game textures the alpha channel is a colour mask (face, eyes) and cutting it makes holes. |

For the whole page:

| Field           | What it does                                                        |
| --------------- | ------------------------------------------------------------------- |
| `version`       | Change it ("3", "4"...) when you replace files with the same name, so visitors don't see a cached old version |
| `autoRotate`    | Slowly spin the model when the page opens                           |
| `playAnimation` | Play the first animation in a model, if it has one                  |
| `background`    | Any CSS background, e.g. `"#20242a"`; leave empty for the default   |

## Controls

| | Desktop | Phone |
| --- | --- | --- |
| Rotate | Drag | Drag |
| Zoom | Scroll | Pinch |
| Move | Right-drag | Two-finger drag |
| Focus on a spot | Double-click it | Double-tap it |
| Reset the view | Double-click the background, or the reset button | Double-tap the background, or the reset button |

## First-time setup

```bash
npm install
npm run dev        # local preview at http://localhost:5173
```

On GitHub:

1. Create a repository and push this project to the `main` branch.
2. Go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. The site will be at `https://<your-user>.github.io/<repo-name>/`.

## Tips for fast loading on phones

- Keep textures at 2048 px or smaller. TGA is uncompressed, so a 2048 px TGA
  is about 16 MB, while the same texture as JPG is often under 1 MB.
- GitHub rejects single files over 100 MB. For larger files use Git LFS
  (`git lfs track "*.fbx" "*.tga"`); the deploy workflow already supports it.