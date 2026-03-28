LCHS Secure Inventory Management System (First-Release)
Overview

The LCHS Secure Inventory Management System is a JavaScript-based inventory tracking and management platform designed to securely monitor, organize, and manage physical assets. The system provides a lightweight, browser-based interface intended for environments where fast access, clear visibility, and simple deployment are priorities.

This project is currently in pre-release and under active development.

Purpose

The platform was designed to address limitations found in many “cookie-cutter” inventory platforms by providing:

Customizable workflows for local operational needs

Lightweight deployment on small hardware (such as mini-computers or kiosks)

Direct control over data and infrastructure

A streamlined interface for quick asset lookup and updates

Project Status

Moving into first Production Release.

This version is intended for testing, demonstration, and development purposes only.
Some features may be incomplete, unstable, or subject to change.

Known Limitations

Feature set still evolving

Some components may be experimental or incomplete

UI and functionality are subject to change during development

Development Goals

The long-term goal is to create a secure, flexible, and locally controlled inventory management platform capable of running efficiently on lightweight hardware while maintaining professional-level functionality.

Branding Images (Optional)

You can configure logo images in env.js:

- APP_LOGO_URL: used on the login screen (and sidebar if APP_SIDEBAR_LOGO_URL is empty)
- APP_SIDEBAR_LOGO_URL: optional dedicated sidebar logo image

Supported URL formats:

- https:// links
- http:// links
- Relative paths (for example /assets/logo.png)
- data:image/* URLs

If the URL is blank or fails to load, the app falls back to text branding.

Split App Paths

The web app is now scaffolded into two static-path entries for deployment:

- `/kiosk/` for day-to-day kiosk operation workflows
- `/manage/` for management workflows

Implementation notes:

- Both folders currently start from the same duplicated baseline.
- `kiosk/env.js` sets `APP_MODE: 'kiosk'`.
- `manage/env.js` sets `APP_MODE: 'manage'`.
- In manage mode, student logins are blocked in `manage/app.js`; only teacher/developer roles can enter.

GitHub Pages usage:

- Publish the repository as static files, then open `.../kiosk/` or `.../manage/` directly.
- Root (`/`) behavior is unchanged in this first implementation step.

Kiosk Listener Security Configuration

The realtime kiosk listener now uses safe command execution for lock overlays.

- `LOCK_OVERLAY_COMMAND_BIN`: executable path to run when kiosk lock is enabled.
- `LOCK_OVERLAY_COMMAND_ARGS`: optional JSON array of arguments for the command.

Example:

- `LOCK_OVERLAY_COMMAND_BIN=/usr/bin/python3`
- `LOCK_OVERLAY_COMMAND_ARGS=["/opt/kiosk/lock_overlay.py","--fullscreen"]`

Deprecated:

- `LOCK_OVERLAY_COMMAND` string execution is intentionally rejected for security hardening.

Contributions

At this stage, the project is in early development. Feedback, testing results, and improvement suggestions are welcome.

License & Copyright Information:
Copyright © 2026 Wyatt Oehlerking. All rights reserved. This software is proprietary and may not be reproduced, distributed, or used without explicit permission from the author.
Currently used under license. Until further notice, École Secondaire Lacombe Composite High School is granted the right to use this software solely for the purpose of managing the inventory of the Automotive Mechanics, Electro-Technologies, After-School Robotics Program (Also known as the United Robotics of Lacombe or URL). This software is only to be used for non-commercial purposes only whithin these deparments. Furthermore, Any redistribution or modification to/of software, use in unauthorized school enviroments or departments, without my explicit written consent to be considered a breach of this license agreement and use must be ceased immediately.'