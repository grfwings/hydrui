# Hydrui

A web interface for [the hydrus network](https://hydrusnetwork.github.io/hydrus/), a powerful media organizer.

## Documentation

Visit the [Hydrui documentation site](https://hydrui.dev/en/docs/) for usage documentation.

## Archive/Delete filter

Launch the archive/delete filter from a page's context menu. It uses the selected files, or the whole page when nothing is selected, and shows one local file at a time. Files already in the trash are excluded.

- `→` — keep and archive
- `←` — delete (send to trash)
- `↑` — skip
- `↓` — go back and clear that file's decision
- `Escape` — finish and open the commit dialog

Nothing is written until you press Commit. Commits are chunked: files are deleted to the trash first, then kept files are archived. If a request fails partway through, the dialog reports how many changes were saved and retries only the remaining files. Saved changes cannot be undone by returning to filtering.
