# Creek Peek stocking data

This repository feeds the stocking dates in the Creek Peek app (creekpeek.netlify.app).

Twice a day (about 7 AM and 2:30 PM Eastern), a GitHub Action runs `scripts/update-stocking.mjs`. It reads three NC Wildlife sources and saves the result to `stocking.json`, which the app downloads:

| Source | What it gives |
|---|---|
| Hatchery Supported stocking schedule (PDF on ncpaws.org) | Every planned stocking date for the season, by county and stream. Delayed Harvest rows are marked. |
| Delayed Harvest schedule (ncwildlife.gov) | The current month's Delayed Harvest dates. |
| Daily Trout Stockings (ncpaws.org) | What was actually stocked in the last day or two. Kept for 90 days. |

`stocking.json` also has `events`: stockings the job saw for the first time on each run (when it saw them, the date, county and stream), kept 30 days. The app doesn't use it yet; it's there for future "your favorite was stocked" notifications.

## If something breaks

* The Actions tab shows a red X on a day a source couldn't be read. The previous data is kept, so the app keeps working.
* The `status` section of `stocking.json` names the source and the error.
* Usually NC Wildlife changed a page. Send the error to Claude in the Creek Peek project and ask for a fixed `scripts/update-stocking.mjs`, then replace the file here.

## Name fixes

If a stream's stocking dates don't show in the app because NC Wildlife spells it differently, add a line to `aliases` in `names.json` ("County|Their name": "Creek Peek name"). The next run picks it up, or use **Actions → Update stocking data → Run workflow** to run it now.

## Keep it running

GitHub pauses scheduled jobs in a public repository after 60 days with no commits. Every run that finds new data makes a commit, so during the season this takes care of itself. If you get an email that the workflow was disabled, open the Actions tab and click **Enable workflow**.

## Test without the network

```
FIXTURES=path/to/saved/pages node scripts/update-stocking.mjs
```
The folder holds `hs_schedule.pdf`, `dh.html`, `paws.html` and, optionally, `dh.csv`.
