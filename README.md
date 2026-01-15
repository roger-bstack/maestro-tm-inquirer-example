# Maestro Test Management Inquirer Example

## Overview

This project provides a command‑line interface (CLI) built with **Inquirer** that lets you:

- Run Maestro test suites locally.
- Upload an Android/iOS app and Maestro test suite to **BrowserStack**.
- Create and manage test runs, configurations, and results in **BrowserStack Test Management**.

The CLI guides you through selecting the execution mode, providing paths to your test suite and app, choosing a device, and linking to a BrowserStack project.

## Prerequisites

- **Node.js** (v14 or newer) installed.
- **npm** (comes with Node) to install dependencies.
- A BrowserStack account with `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` set in your environment.
- An Android or iOS app (`.apk` or `.app`) to test.
- A Maestro test suite (YAML files) organized in a directory.

## Installation

```bash
# Install project dependencies
npm install
```

## Usage

Run the CLI with:

```bash
npm start
```

You will be prompted for the following information:

1. **Execution type** – Choose **Locally** to run the Maestro test suite on your machine, or **On BrowserStack** to run it in the cloud.
2. **Maestro test directory** – Path to the folder containing your Maestro `.yaml` files.
3. **App path** – Path to the `.apk` (Android) or `.ipa` (iOS) file you want to test.
4. **Device** – Device name (e.g., `iPhone 13`, `Samsung Galaxy S21`). The CLI will parse the device name and OS version.
5. **BrowserStack project name** – Name of the project in BrowserStack Test Management.
6. **BrowserStack project ID** – Numeric ID of the BrowserStack project.

If you select **On BrowserStack**, the CLI will:

- Upload the app to BrowserStack.
- Zip and upload the Maestro test suite.
- Resolve or create a device configuration.
- Create a test run linked to any associated JIRA issues.
- Trigger a Maestro build on BrowserStack.
- Poll the build status and report the final result.
- Add the test result to the test run and close the run.

If you select **Locally**, the CLI simply runs `maestro test <your-test-dir>`.

## Environment Variables

Set the following environment variables before running the CLI:

```bash
export BROWSERSTACK_USERNAME=your_username
export BROWSERSTACK_ACCESS_KEY=your_access_key
```

## Project Structure (example)

```
├── index.js                # Main CLI implementation
├── package.json            # Project metadata & dependencies
├── README.md               # This file
├── WikipediaSample.apk     # Sample Android app (optional)
└── SAMPLE_ANDROID_TEST/    # Example Maestro test suite
    ├── master.yml
    └── subflows/
        ├── calculator.yml
        └── wikipediaAppTest.yml
```

## Scripts

- `npm start` – Runs the CLI (`node index.js`).

## License

ISC

---

*Generated automatically from the source code and package metadata.*
