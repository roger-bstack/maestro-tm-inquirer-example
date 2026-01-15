import inquirer from 'inquirer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { exec } from 'child_process';
import FormData from 'form-data';
import yaml from 'js-yaml';

const BROWSERSTACK_API_BASE = 'https://api.browserstack.com';
const BROWSERSTACK_TM_API_BASE = 'https://test-management.browserstack.com';
const BROWSERSTACK_USERNAME = process.env.BROWSERSTACK_USERNAME;
const BROWSERSTACK_ACCESS_KEY = process.env.BROWSERSTACK_ACCESS_KEY;

/**
 * Upload an app (APK/IPA) to BrowserStack.
 */
async function uploadAppToBrowserStack(appPath) {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(appPath));

    const response = await axios.post(
      `${BROWSERSTACK_API_BASE}/app-automate/maestro/v2/app`,
      form,
      {
        headers: form.getHeaders(),
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    return response.data.app_url;
  } catch (error) {
    console.error('Failed to upload app to BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a zip archive of a Maestro test suite directory.
 */
async function createTestSuiteZip(maestroTestDir) {
  const zipFilePath = path.resolve(maestroTestDir, '../maestro-test-suite.zip');
  const output = fs.createWriteStream(zipFilePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipFilePath));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(maestroTestDir, 'test_suite');
    archive.finalize();
  });
}

/**
 * Run a Maestro test suite locally.
 */
async function runTestLocally(maestroTestDir) {
  console.log(`Running Maestro test locally from directory: ${maestroTestDir}`);

  return new Promise((resolve, reject) => {
    const command = `maestro test ${maestroTestDir}`;
    const process = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing Maestro test: ${error.message}`);
        reject(error);
      } else {
        console.log(`Maestro test output:\n${stdout}`);
        if (stderr) console.error(`Maestro test errors:\n${stderr}`);
        resolve(stdout);
      }
    });

    process.stdout?.pipe(process.stdout);
    process.stderr?.pipe(process.stderr);
  });
}

/**
 * Upload a zipped test suite to BrowserStack.
 */
async function uploadTestSuiteToBrowserStack(zipFilePath) {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(zipFilePath));

    const response = await axios.post(
      `${BROWSERSTACK_API_BASE}/app-automate/maestro/v2/test-suite`,
      form,
      {
        headers: form.getHeaders(),
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    return response.data.test_suite_url;
  } catch (error) {
    console.error('Failed to upload test suite to BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Retrieve project details from BrowserStack Test Management.
 */
async function getProjectDetails(projectId) {
  try {
    const response = await axios.get(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/projects/${projectId}`,
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    return response.data.project;
  } catch (error) {
    console.error('Failed to fetch project details from BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get existing configuration or create a new one for given device and OS version.
 */
async function getOrCreateConfiguration(deviceName, osVersion, os, geoLocation) {
  try {
    // Fetch existing configurations with pagination handling
    let page = 1;
    let configName = `${deviceName} - ${os} ${osVersion} - ${geoLocation}`
    console.log(`Checking configuration: '${configName}'...`)

    while (true) {
      console.log(`Fetching Configurations, Page: ${page}`);
      const configsResponse = await axios.get(
        `${BROWSERSTACK_TM_API_BASE}/api/v2/configurations`,
        {
          params: { p: page },
          auth: {
            username: BROWSERSTACK_USERNAME,
            password: BROWSERSTACK_ACCESS_KEY,
          },
        }
      );

      const pageConfigs = configsResponse.data.configurations || [];

      // Find matching configuration
      const existing = pageConfigs.find(
        (c) =>
          // c.device?.toLowerCase() === deviceName.toLowerCase() &&
          // c.os_version?.toString() === osVersion &&
          c.name?.toString() === configName
      );
      if (existing) {
        console.log(`Found existing configuration for '${configName}':`, existing.id);
        return existing.id;
      }

      // Pagination termination: check for next page indicator
      const nextPage = configsResponse.data.info?.next || null;

      if (!nextPage) {
        break;
      } else {
        page = nextPage;
      }
    }

    // Create new configuration if not found
    const createResponse = await axios.post(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/configurations`,
      {
        name: configName,
        device: deviceName,
        os_version: osVersion,
      },
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    const newConfig = createResponse.data;
    console.log('Created new configuration:', JSON.stringify(newConfig));
    return newConfig.id;
  } catch (error) {
    console.error('Error handling configuration:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Execute a Maestro build on BrowserStack.
 */
async function executeMaestroBuildOnBrowserStack(appUrl, testSuiteUrl, devices, projectId) {
  try {
    const projectDetails = await getProjectDetails(projectId);
    const projectName = projectDetails.name;
    console.log(`Executing Maestro build on BrowserStack for project: ${projectName}`);

    const response = await axios.post(
      `${BROWSERSTACK_API_BASE}/app-automate/maestro/v2/android/build`,
      {
        app: appUrl,
        testSuite: testSuiteUrl,
        devices: devices,
        project: 'RJ_Maestro_Tests',
        debug: "true",
        networkLogs: "true",
        deviceLogs: "true",
      },
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to execute Maestro build on BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Poll the status of a BrowserStack build until it finishes or times out.
 */
async function pollBuildStatus(buildId, timeout = 30 * 60 * 1000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(
        `${BROWSERSTACK_API_BASE}/app-automate/maestro/v2/builds/${buildId}`,
        {
          auth: {
            username: BROWSERSTACK_USERNAME,
            password: BROWSERSTACK_ACCESS_KEY,
          },
        }
      );

      const { status } = response.data;
      console.log(`Build status for ${buildId}: ${status}`);

      if (status !== 'running') return response.data;
    } catch (error) {
      console.error('Error fetching build status:', error.response?.data || error.message);
    }

    await new Promise((res) => setTimeout(res, 30000)); // Wait 30 seconds
  }

  throw new Error('Build status polling timed out');
}

/**
 * Close a test run on BrowserStack.
 */
async function closeTestRunOnBrowserStack(projectId, testRunId) {
  try {
    const response = await axios.post(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/projects/${projectId}/test-runs/${testRunId}/close`,
      {},
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    console.log('Test run closed successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to close test run on BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Add a test result to BrowserStack.
 */
async function addTestResultToBrowserStack(projectId, testCaseId, testRunId, status, issues, configurationId) {
  try {
    const response = await axios.post(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/projects/${projectId}/test-runs/${testRunId}/results`,
      {
        test_result: { status, issues },
        test_case_id: testCaseId,
        configuration_id: configurationId
      },
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    console.log('Test result added successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to add test result to BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch details for a specific test case.
 */
async function getTestCaseDetails(projectId, testCaseId) {
  try {
    const response = await axios.get(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/projects/${projectId}/test-cases?id=${testCaseId}`,
      {
        params: { id: testCaseId },
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to fetch test case details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a test run on BrowserStack, linking any associated issues.
 */
async function createTestRunWithLinkedRequirements(testCaseId, projectId, maestroFlowName, configurationId) {
  try {
    const testCaseDetails = (await getTestCaseDetails(projectId, testCaseId)).test_cases[0];
    const linkedIssues = (testCaseDetails.issues || []).map((issue) => issue.jira_id);
    const issueTracker = testCaseDetails.issue_tracker || {};

    const response = await axios.post(
      `${BROWSERSTACK_TM_API_BASE}/api/v2/projects/${projectId}/test-runs`,
      {
        test_run: {
          name: `Test Run for: ${maestroFlowName}`,
          description: `Automated test run for Maestro flow: ${maestroFlowName}`,
          run_state: 'new_run',
          assignee: 'test.assignee@example.com', // TODO: replace with real assignee
          test_cases: [testCaseId],
          issues: linkedIssues,
          issue_tracker: issueTracker,
          configurations: [configurationId]
        },
      },
      {
        auth: {
          username: BROWSERSTACK_USERNAME,
          password: BROWSERSTACK_ACCESS_KEY,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Failed to create test run on BrowserStack:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Recursively collect Maestro flow names from YAML files.
 */
async function getMaestroFlowNames(maestroTestDir) {
  const flowNames = [];

  for (const entry of fs.readdirSync(maestroTestDir)) {
    const entryPath = path.join(maestroTestDir, entry);
    const stats = fs.lstatSync(entryPath);

    if (stats.isDirectory()) {
      flowNames.push(...(await getMaestroFlowNames(entryPath)));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      try {
        const docs = yaml.loadAll(fs.readFileSync(entryPath, 'utf8'));
        for (const doc of docs) {
          if (doc && typeof doc === 'object' && 'appId' in doc && 'name' in doc) {
            flowNames.push(doc.name);
          }
        }
      } catch (error) {
        console.error(`Failed to parse YAML file: ${entryPath}`, error);
      }
    }
  }

  return flowNames;
}

/**
 * Main entry point: prompt user, then run locally or on BrowserStack.
 */
async function main() {
  try {
    const answers = await inquirer.prompt([
      {
        type: 'select',
        name: 'executionType',
        message: 'How would you like to run the tests?',
        choices: ['Locally', 'On BrowserStack'],
      },
      {
        type: 'input',
        name: 'maestroTestDir',
        message: 'Enter the path to the Maestro test project directory:',
        validate: (input) => input ? true : 'Test project directory path cannot be empty.',
      },
      {
        type: 'input',
        name: 'appPath',
        message: 'Enter the path to the app under test:',
        validate: (input) => input ? true : 'App path cannot be empty.',
      },
      {
        type: 'input',
        name: 'device',
        message: 'Enter the device to run the tests on (e.g., iPhone 13, Samsung Galaxy S21):',
        validate: (input) => input ? true : 'Device cannot be empty.',
      },
      {
        type: 'input',
        name: 'projectName',
        message: 'Enter the BrowserStack test project name:',
        validate: (input) => input ? true : 'Project name cannot be empty.',
      },
      {
        type: 'input',
        name: 'projectId',
        message: 'Enter the BrowserStack Test Management project ID:',
        validate: (input) => input ? true : 'Project ID cannot be empty.',
      },
    ]);

    const [deviceName, osVersion] = answers.device.split('-').map(s => s.trim());


    const flowNames = await getMaestroFlowNames(answers.maestroTestDir);
    console.log('Discovered Maestro flow names:', flowNames);

    if (flowNames.length === 0) {
      throw new Error('No Maestro flow files with appId and name properties found in the specified directory.');
    }

    const flowAnswer = await inquirer.prompt([
      {
        type: 'select',
        name: 'selectedFlowName',
        message: 'Select the Maestro flow name to use:',
        choices: flowNames,
        default: flowNames[0],
      },
    ]);

    const maestroFlowName = flowAnswer.selectedFlowName;

    const osAnswer = inquirer.prompt([
      {
        type: 'select',
        name: 'selectedOs',
        message: 'Select an OS to use:',
        choices: ['Android', 'iOS'],
        default: 'Android'
      },
    ]);

    const os = (await osAnswer).selectedOs;

    const geoLocationAnswer = inquirer.prompt([
      {
        type: 'select',
        name: 'selectedGeoLocation',
        message: 'Select a Geo Location to use:',
        choices: ['UK', 'US', 'IN'],
        default: 'UK',
      },
    ]);

    const geoLocation = (await geoLocationAnswer).selectedGeoLocation;

    console.log('Your selections:', answers, '\nSelected Flow Name:', maestroFlowName);

    if (answers.executionType === 'Locally') {
      await runTestLocally(answers.maestroTestDir);
    } else if (answers.executionType === 'On BrowserStack') {
      console.log('Preparing test suite for BrowserStack...');
      try {
        const appUrl = await uploadAppToBrowserStack(answers.appPath);
        console.log('App uploaded successfully:', appUrl);

        const zipFilePath = await createTestSuiteZip(answers.maestroTestDir);
        console.log('Test suite zip created at:', zipFilePath);

        const testSuiteUrl = await uploadTestSuiteToBrowserStack(zipFilePath);
        console.log('Test suite uploaded successfully:', testSuiteUrl);

        const testCaseIdMatch = maestroFlowName.match(/\[(.*?)\]/);
        const testCaseId = testCaseIdMatch ? testCaseIdMatch[1] : null;

        if (!testCaseId) {
          throw new Error('Test Case ID not found in Maestro flow name. Ensure it is enclosed in square brackets.');
        }

        let testCaseDetails = await getTestCaseDetails(answers.projectId, testCaseId);
        testCaseDetails = testCaseDetails.test_cases[0];
        console.log('Test case issues fetched:', JSON.stringify(testCaseDetails.issues, null, 2));
        const linkedIssues = testCaseDetails.issues.map(issue => issue.jira_id) || [];
        console.log('Linked issues:', linkedIssues);

        const configurationId = await getOrCreateConfiguration(deviceName, osVersion, os, geoLocation);
        console.log('Using configuration ID:', configurationId);

        const testRun = await createTestRunWithLinkedRequirements(testCaseId, answers.projectId, maestroFlowName, configurationId);
        console.log('Test run created:', testRun);

        const buildExecution = await executeMaestroBuildOnBrowserStack(appUrl, testSuiteUrl, [answers.device], answers.projectId);
        console.log('Build execution started:', buildExecution);

        const buildStatus = await pollBuildStatus(buildExecution.build_id);
        console.log('Final build status:', buildStatus);

        const testResultStatus = buildStatus.status === 'passed' ? 'passed' : 'failed';
        await addTestResultToBrowserStack(answers.projectId, testCaseId, testRun.test_run.identifier, testResultStatus, linkedIssues, configurationId);

        await closeTestRunOnBrowserStack(answers.projectId, testRun.test_run.identifier);
      } catch (error) {
        console.error('Error during BrowserStack integration:', error);
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

main();
