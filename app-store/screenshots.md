# Store screenshot capture sheet

Status: **not captured for the release builds**. Use the signed or final release-configured apps with a fresh fictional workspace. Existing screenshots of browser previews and the publisher's migrated workspace are not submission assets.

| Order | Screen                   | Fictional content                                                 | Purpose                                                      |
| ----- | ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | Today                    | Review a paper; prepare a lecture; take a walk                    | A short, deliberate daily plan with a later deadline visible |
| 2     | Task detail              | A short note with a rendered equation, checklist, and image       | Notes and work details stay beside the task                  |
| 3     | Work days picker         | Today plus two nonconsecutive days, separate later deadline       | Demonstrate independent work days and deadline               |
| 4     | Calendar                 | Dedicated test calendar with one event linked to a fictional task | Show the clear task-link indicator without overcrowding      |
| 5     | Open checkboxes or Board | Two active tasks with unfinished steps, or three workflow columns | Show next actions and organization                           |

Capture the same five concepts on iPhone and Mac, adapted to the real layout. Capture iPad too while `TARGETED_DEVICE_FAMILY` remains `1,2`. Show the actual software keyboard where it helps, but keep it dismissed in the overview shots. Mac screenshots should show the release app window, not other desktop apps, account names, folders, or unrelated menu-bar information.

## Accepted upload slots

Apple's specifications checked 15 September 2026:

| Platform              | Practical capture size                         | Requirement                                                                                        |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| iPhone, 6.9-inch slot | 1320 × 2868 portrait                           | Covers the main iPhone slot; 6.5-inch screenshots are required when a 6.9-inch set is not provided |
| iPad, 13-inch slot    | 2064 × 2752 portrait, or 2752 × 2064 landscape | Required because this target supports iPad                                                         |
| macOS                 | 1440 × 900 or 2880 × 1800                      | Required for the Mac platform; use 16:10                                                           |

Use opaque PNG or JPEG, one to ten screenshots per set. Confirm available slots in App Store Connect before upload. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

## Final capture check

- Use the final app name, green theme, and actual release behavior. Do not include unavailable features or claim immediate iCloud delivery.
- Clear real task content, attachment filenames, calendar/account identities, and debug banners. Use files created for the example.
- Review full-size screenshots for truncated text, clipping, unrendered equations, misleading empty states, and exposed system permission sheets.
- Record the app version/build and dimensions beside the files. Re-capture if the submitted build materially changes the screen.
- Do not upscale a browser screenshot to stand in for a native device capture. Optional captions can explain the feature without obscuring the real interface.
