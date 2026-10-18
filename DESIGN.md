# BizBuilders visual reference

**Source:** [bizbuilders.sk](https://bizbuilders.sk/) homepage, inspected 17 October 2026.  
**Use:** Apply BizBuilders brand cues to the internal BizBase business console while preserving a compact, readable operations interface.

## Observed design tokens

The live Shopify theme exposes its font and color values as CSS variables. These are observed page tokens; their adaptation to a data-dense console is a design decision.

| Token | Value | Role |
|---|---|---|
| Deep navy | `#011624` | Main foreground, dark branded surfaces |
| BizBuilders purple | `#5230DA` | Primary brand/action color |
| Golden yellow | `#FACD11` | Occasional highlight / attention accent |
| Mint | `#EFF5F5` | Soft tinted surface |
| White | `#FFFFFF` | Main page and cards |
| Border | `#E6E8E9` | Hairline dividers |
| Secondary text | `#67737C` | Supporting text |
| Body font | DM Sans, 500 | Body, controls, navigation |
| Heading font | Poppins, 600 | Page and section headings |

## Design direction for BizBase

- Keep BizBase's restrained, product-like shell and dense operational tables. Use white content surfaces, a very light mint application canvas, and navy text.
- Use purple for selected navigation, primary buttons, and key links. Reserve yellow for a small number of status or emphasis treatments; do not make it a general call-to-action color.
- Use DM Sans throughout interface controls and data. Use Poppins for page and section titles, with moderate weights and compact sizes so reporting stays legible.
- Retain the console's existing compact radii, spacing, and low-contrast dividers. The reference is a marketing site; its oversized display typography, rounded CTA buttons, gradients, photos, and promotional sections are not appropriate for operational screens.

## Evidence and capture

- The homepage's rendered text and visible layout were inspected in the browser; its hero uses large bold Poppins headings, a white navigation surface, and a purple announcement strip.
- Browser computed styles confirm `--font-body-family: "DM Sans", sans-serif` and `--font-heading-family: Poppins, sans-serif`.
- Theme variables include foreground `1, 22, 36`, button/accent `82, 48, 218`, yellow background `250, 205, 17`, mint background `239, 245, 245`, white background, border `230, 232, 233`, and secondary foreground `103, 115, 124`.
- A screenshot was inspected in the browser on the capture date; no screenshot file is bundled with this project.

## Rerun inputs

- `https://bizbuilders.sk/`
