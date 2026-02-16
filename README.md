# GeoStats

A Tampermonkey userscript that tracks your GeoGuessr game performance.

## What it does

GeoStats automatically monitors your GeoGuessr games and collects detailed statistics about your performance. It tracks:

- Game scores and map types
- Individual round performance
- Guess locations vs. actual locations
- Distance accuracy
- Country identification

The script runs in the background while you play and stores all data locally in your browser.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. Click on the Tampermonkey icon and select "Create a new script"
3. Copy the contents of `stats-script.js` into the editor
4. Save the script (Ctrl+S or Cmd+S)
5. Navigate to geoguessr.com - the script will activate automatically

## Features

- **Automatic tracking**: Monitors games without any manual input required
- **Export data**: Download your stats as CSV for analysis
- **Import history**: Fetch recent game data from your GeoGuessr account
- **Pause/resume**: Control when tracking is active
- **Country detection**: Uses geographic data to identify guess and actual countries

## Usage

Once installed, you'll see a green stats button on the right side of GeoGuessr. Click it to:

- View current game tracking status
- Export your data as CSV
- Import recent games from your account
- Pause or resume tracking
- Clear all stored data

## Data Storage

All stats are stored locally using Tampermonkey's storage API. Your data stays in your browser and is not sent anywhere.

## Requirements

- Tampermonkey (or compatible userscript manager)
- Modern browser with JavaScript enabled
- Active GeoGuessr account

## Notes

The script loads geographic data from Natural Earth to determine countries. This happens automatically on first use and may take a moment.

## License

Created by Ben Foronda
