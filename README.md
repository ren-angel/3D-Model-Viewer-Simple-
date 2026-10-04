# 3D model viewer

A small, fast viewer for one FBX model (with TGA/PNG/JPG textures), built with Vite and three.js and hosted on GitHub Pages.

## Changing the model

1. Put your `.fbx` file and all its textures in `public/assets/`.
2. Open `public/assets/viewer.json` and set `model` to the FBX file name.
3. Commit and push. GitHub builds and publishes the site in a minute or two.

Texture paths inside the FBX don't matter: the viewer ignores the folders the
FBX remembers (like `C:\Users\you\Desktop\...`) and looks for each texture by
file name in `public/assets/`. GitHub Pages is case-sensitive, so `Wood.TGA`
and `wood.tga` are different files. If a texture can't be found, the page
shows a message listing the missing names.

### viewer.json

| Field           | What it does                                                        |
| --------------- | ------------------------------------------------------------------- |
| `title`         | Name shown on the page and in the browser tab                       |
| `description`   | Optional line of text under the title                               |
| `model`         | FBX file name inside `public/assets/`                               |
| `version`       | Change it ("2", "3"...) when you replace files with the same name, so visitors don't see a cached old version |
| `autoRotate`    | Slowly spin the model when the page opens                           |
| `playAnimation` | Play the first animation in the FBX, if it has one                  |
| `background`    | Any CSS background, e.g. `"#20242a"`; leave empty for the default   |

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
