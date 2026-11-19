# Creek Peek partners (fly shop sponsors)

Creek Peek reads `partners.json` from this repository, along with the logos in the `partners/` folder. Adding, changing or removing a shop is an edit here. It needs no website upload and no app update. Phones pick up a change the next time Creek Peek is opened (it checks at most every 30 minutes).

## Add a shop

1. **Logo:** open the `partners` folder on github.com, then **Add file → Upload files**. Use a PNG (or JPG or WebP) about 400 pixels wide and under 150 KB, named with lower-case letters and dashes, like `brevard-fly-shop.png`.
2. **Entry:** open `partners.json`, click the pencil, and copy an existing entry inside `"partners": [ … ]`. Put a comma between entries. Change the fields (below), then **Commit changes**.
3. **Check:** a minute later the commit shows a green check or a red X. A red X means something needs fixing: click it, then **Details**, and the log says what (for example, a misspelled field or an unknown river id). The app skips anything it can't use, so a mistake never breaks it.
4. **Look at it:** while a new entry still has `"test": true`, only phones in partner test mode show it (see below). Check it on your phone, then delete the `"test": true,` line to make it public.

## The fields

| Field | Needed? | What it is |
|---|---|---|
| `id` | yes | Short name, lower-case letters, numbers and dashes: `brevard-fly-shop`. Never reuse one; it's how view counts are kept. |
| `name` | yes | Shown on the card, 60 characters at most. |
| `type` | yes | `"river"` or `"watershed"`. |
| `rivers` | river partners | List of river ids: `["03441000", "nwm:22164234"]`. Look them up in **RIVER-IDS.md**, or open the river in Creek Peek, tap Share, and copy the part after `?river=`. |
| `watersheds` | watershed partners | List of basin ids: `["upper-french-broad"]`. The basins are listed in RIVER-IDS.md. A watershed partner covers every water in the basin. |
| `start`, `end` | no | Dates it runs, like `"2026-12-01"`. It appears on `start` and disappears after `end` on its own. Leave either out for no limit. |
| `logo` | no | `"partners/brevard-fly-shop.png"`. Without one, the card shows the shop's initials. |
| `tagline` | no | One line under the name, 90 characters at most. |
| `links` | no | Any of: `shop`, `podcast`, `book` (web addresses starting with `https://`), `phone` (`"828-555-0100"`), `directions` (`"35.2338,-82.7343"`: in Google Maps, right-click the shop and click the numbers to copy them). |
| `hatch` | no | `{ "updated": "2026-11-19", "text": "…" }`, 400 characters at most. Update the date with each new report. |
| `placements` | no | Where things show (below). Leave it out for the standard package. |
| `weight` | no | Share of the rotation. Standard: watershed 2, river 1. Use any number from 0.1 to 10. |
| `test` | no | `true` = only phones in partner test mode show it. |
| `notes` | no | For you (billing, contact). The app ignores it. |

### Placements

```json
"placements": {
  "card": ["now", "rules", "favorites"],
  "hatch": ["now"],
  "buttons": ["shop", "podcast", "phone", "directions"]
}
```

- `card`: where the shop card shows. `now` is the Now tab, below the flow chart. `rules` is the Rules & links tab, below the stocking dates. `favorites` is a small "Partner: shop" line under that river in Favorites.
- `hatch`: where the hatch report shows (`now`, `rules`). If the card isn't in the same place, the report shows on its own with the shop's name.
- `buttons`: which links get buttons, in this order. A link that isn't listed gets no button.
- Leave `placements` out and you get the card and hatch report on Now, with a button for every link.

## Who shows up where

- One partner shows on a river at a time. The pool is the river's own partners plus its basin's watershed partners.
- Each phone picks one partner per river per day and keeps it all day. Different people get different picks, so on any day each shop is seen by some anglers.
- Over many anglers, the shares follow `weight`. With the standard weights, a watershed partner is shown about twice as often as a river partner on the same river.

## Partner test mode

On your phone, open Creek Peek and scroll to the bottom of the Now tab, to "Creek Peek · Version …". Tap that line five times quickly. A message says "Partner test mode on", and entries marked `"test": true` now show on that phone only. Tap five times again to turn it off.

## Numbers for shops

Creek Peek counts anonymously (no names, no tracking) on the visit-count dashboard (creekpeek.goatcounter.com):
- `partner/<id>/view`: the shop was shown on a river, counted once per river, per phone, per day.
- `partner/<id>/shop`, `/podcast`, `/book`, `/phone`, `/directions`: button taps. `/fav-…` are taps on the Favorites line.

## When waters are added to Creek Peek

`partner-targets.json` (the list the check uses) and `RIVER-IDS.md` come from the app. Ask Claude to regenerate them along with `waters.json`.
