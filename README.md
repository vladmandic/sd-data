# Dynamically generated data for SD main repo

Used to create:

- Extensions data
- Benchmark data

## Structure

- `.github/workflows`: definitions of github actions that run as cron jobs
- `jobs`: scripts triggered by github actions
- `inputs`: data gathered by github actions
- `lists`: manually created lists
- `pages`: data created by github actions
- `views`: helper html pages to view data

## Extensions workflow

1. Job runs every 2h, 30min past the hour
2. Fetch original list from A1111  
   - Saved as: `inputs/a1111-extensions.json`
3. Create master list  
   - Fetch additional data using github api for each entry
4. Parse additional data from `lists` folder
   - Updates or append master lists  
   - Fetches addtional data using github api where needed  
5. Create final list  
   - Saved as: `pages/extensions.json`

### Extensions additional data

- Folder `lists` can contain any number of additional JSON files  
  *those are only files that should be manually edited*
- Structure of each JSON file should always be array of objects  
  where each object at least has a `name` property  
- If `name` is matched to a known name from master list, master list data is updated with info from the object  
- If `name` is not matched, master list is appended with the object  
- if object has `url` property, additional data is fetched about it using github api

### Extensions viewer

- `views/extensions.html` is a simple html page that loads `pages/extensions.json` and displays it in a table  
  External URL: <https://vladmandic.github.io/sd-data/views/extensions.html>  

## Benchmark workflow

TBD
