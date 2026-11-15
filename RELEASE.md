# Releasing WakeIt

Do these steps yourself, in order. They publish under your own accounts.

## 1. Check the build

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run smoke
```

All five commands must finish without errors.

## 2. Push to GitHub

```powershell
git push origin main
git tag v1.1.0
git push origin v1.1.0
```

## 3. Publish to npm

```powershell
npm login
npm publish --access public
```

`npm publish` runs the checks from step 1 again before uploading. Afterwards, open https://www.npmjs.com/package/@lalit_kumar/wakeit and confirm it shows version 1.1.0.

## 4. Get a DOI from Zenodo

A DOI makes the software citable in the paper.

1. Sign in at https://zenodo.org with your GitHub account.
2. Open your Zenodo profile menu, choose **GitHub**, and switch the `WakeIt` repository **on**.
3. On GitHub, open the repository, choose **Releases**, then **Draft a new release**.
4. Pick the tag `v1.1.0`, give it the title `WakeIt v1.1.0`, paste the 1.1.0 section of `CHANGELOG.md`, and publish.
5. Zenodo archives the release within a few minutes. Open the Zenodo GitHub page again and copy the DOI badge.
6. Add the DOI to `CITATION.cff` (the two commented lines at the bottom), to `README.md`, and to the paper's artifact sentence.

Zenodo's steps can change. If the screens differ, follow https://docs.github.com/en/repositories/archiving-a-github-repository/referencing-and-citing-content

## 5. Archive the measurement data

After the experiments, upload the CSV files from `bench/results/` as a second Zenodo record, or add them to the GitHub release, so the paper's numbers can be checked.
