import sharp from "sharp";
import { findSubImagePosition } from "./image";
import {
  clickButtonWithText,
  getScreenshot,
  ocrScreenArea,
  runADBCommand,
  sleepRandom,
  touchScreen,
  sleep,
  ocrTextWithRect,
  findImagePosition,
} from "./utils";
import { readFileSync, promises as fsPromises } from "fs";
import console from "console";
import path from "path";

const util = require("util");
const exec = util.promisify(require("child_process").exec);

const TOLERANCE = 65;
const AVATAR_IMAGE_PATH = "./imgs/avatar1.png";
const adbOptions = "-e";
const DEFAULT_WAIT_TIME = 15000;
const DEFAULT_WAIT_TIME_LONG = 15000;
const ADB_PATH = "D:\\LDPlayer\\LDPlayer9\\adb.exe";
const LDPLAYER_PATH = "D:\\LDPlayer\\LDPlayer9\\ldconsole.exe";
const LDPLAYER_NAME = "tee"; // Your LDPlayer instance name

const RESOURCE_BUTTONS = {
  gold: { x: 426, y: 639 },
  wood: { x: 630, y: 639 },
  ore: { x: 839, y: 639 },
  mana: { x: 1056, y: 639 },
};

const TROOP_BUTTONS: Record<string, { x: number; y: number }> = {
  troop1: { x: 934, y: 116 },
  troop2: { x: 990, y: 116 },
  troop3: { x: 1045, y: 116 },
  troop4: { x: 1104, y: 116 },
  troop5: { x: 1161, y: 116 },
};

async function killApp() {
  console.log("kill app");
  await exec(`"${LDPLAYER_PATH}" quit --name ${LDPLAYER_NAME}`);
}

async function startApp() {
  try {
    const res = await exec(
      `"${LDPLAYER_PATH}" isrunning --name ${LDPLAYER_NAME}`
    );
    if (res.stdout.includes("running")) {
      console.log("LDPlayer is already running");
      return;
    }
    console.log("start app");
    await exec(`"${LDPLAYER_PATH}" launch --name ${LDPLAYER_NAME}`);
    console.log("wait for ld to start");
    await sleep(20000);
    console.log("connect to ld");
    await exec(`"${ADB_PATH}" connect 127.0.0.1:5555`);
    await sleep(10000);
    console.log(await exec(`"${ADB_PATH}" devices`));
  } catch (error) {
    console.error("Error starting ld:", error);
    throw error;
  }
}

async function killGame() {
  console.log("kill game");
  await runADBCommand(adbOptions, "shell am kill com.farlightgames.samo.gp.vn");
  await sleepRandom(1000);
  await runADBCommand(
    adbOptions,
    "shell am force-stop com.farlightgames.samo.gp.vn"
  );
}

async function scrollDown(startx: number, starty: number) {
  console.log("scroll down");
  await runADBCommand(
    adbOptions,
    `shell input swipe ${startx} ${starty} ${startx} ${
      starty - Math.round(100 + Math.random() * 20)
    }`
  );
  await sleepRandom(100);
}
async function findSubImageInCurrentScreen(imgPath: string, t = TOLERANCE) {
  const img = await getScreenshot(adbOptions);
  if (!img) {
    console.error("Could not get screenshot");
    await killApp();
    process.exit(1);
  }

  const subImg = await sharp(imgPath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const results = findSubImagePosition(
    {
      width: img.info.width,
      height: img.info.height,
      data: new Uint8ClampedArray(img.data),
    },
    {
      width: subImg.info.width,
      height: subImg.info.height,
      data: new Uint8ClampedArray(subImg.data),
    },
    t
  );
  return results;
}
async function waitForSubImage(imgPath: string, timeout: number) {
  const subImg = await sharp(imgPath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const img = await getScreenshot(adbOptions);
    if (!img) {
      console.error("Could not get screenshot");
      await killApp();
      process.exit(1);
    }

    const result = findSubImagePosition(
      {
        width: img.info.width,
        height: img.info.height,
        data: new Uint8ClampedArray(img.data),
      },
      {
        width: subImg.info.width,
        height: subImg.info.height,
        data: new Uint8ClampedArray(subImg.data),
      },
      TOLERANCE
    );
    if (result !== null) {
      console.log("[waitForSubImage] found " + imgPath);
      return result;
    }

    const texts = await ocrScreenArea(adbOptions, {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
    if (texts.some((t) => t.text === "Slide to complete the puzzle")) {
      await fsPromises.writeFile(
        "./isBotChecking.lock",
        "isBotChecking.lock",
        "utf-8"
      );
      console.log("isBotChecking.lock created");
      await sendAlerts(
        "Slide to complete the puzzle, please check the game",
        "app",
        new Error("Slide to complete the puzzle")
      );
      await flushAlerts();
      process.exit(0);
    }
    await sleep(1000);
  }
}
let sendAlertsTimeout: ReturnType<typeof setTimeout> | null = null;
let sendMessageBatch: string[] = [];
async function sendDiscordMessage(message: string, err?: unknown) {
  const chatId = "-1002059527633";
  const botToken = "7286680375:AAFNEeer3L_qAW4du7Y00st1mJlNBth_ZqI";
  const payload = {
    chat_id: chatId,
    parse_mode: "HTML",
    text: message,
    ...(err
      ? {
          embeds: [
            {
              fields: [
                {
                  name: "Error",
                  value: JSON.stringify(err),
                },
              ],
            },
          ],
        }
      : {}),
  };
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  ).catch((err) => {
    console.error("Error sending alert", err);
  });
}
async function sendAlerts(message: string, account: string, err?: unknown) {
  if (err) {
    console.error(`[${account}] ${message}`, err);
  } else {
    console.log(`[${account}] ${message}`);
  }
  if (!err) {
    sendMessageBatch.push(`[${account}] - ${message}`);
    if (sendMessageBatch.length > 10) {
      await flushAlerts();
    }
    if (sendAlertsTimeout) {
      clearTimeout(sendAlertsTimeout);
    }
    sendAlertsTimeout = setTimeout(async () => {
      await flushAlerts();
    }, 30000);
    return;
  }

  await sendDiscordMessage(`[${account}] - ${message}`, err);
}
async function flushAlerts() {
  if (sendMessageBatch.length === 0) return;
  const messageBatch = sendMessageBatch.join("\n");
  sendMessageBatch = [];
  await sendDiscordMessage(messageBatch);
}
function waitForAvatarImage() {
  return waitForSubImage(AVATAR_IMAGE_PATH, 60000);
}

async function startGame() {
  sendAlerts("start game", "app");
  await runADBCommand(
    adbOptions,
    "shell am start -n com.farlightgames.samo.gp.vn/com.harry.engine.MainActivity"
  );
  await sleepRandom(DEFAULT_WAIT_TIME);
  await waitForAvatarImage();
}
export type Troop = [
  name: string,
  resource: "wood" | "gold" | "ore" | "mana",
  troopNumber: number
];

export interface Account {
  email: string;
  enable: boolean;
  gatherProdRss: boolean;
  gatherClanRss: boolean;
  gatherDragonPoint: boolean;
  nextCheckTime: string;
  stats: {
    gold: string;
    wood: string;
    ore: string;
    mana: string;
    gems: string;
  };
  nextAutoGatherTime: string;
  troops: Troop[];
}

const accounts = JSON.parse(readFileSync("./accounts.json", "utf-8")) as Record<
  string,
  Account
>;

async function clickTopLeftAvatar(account: string) {
  sendAlerts("clickTopLeftAvatar", account);
  return touchScreen(adbOptions, 35, 35);
}

async function clickSettingButton(account: string) {
  sendAlerts("clickSettingButton", account);
  return clickButtonWithText(
    adbOptions,
    "Settings",
    { x: 640, y: 100, width: 600, height: 600 },
    { x: 0, y: -50 }
  );
}
async function clickCharacterManagementButton(account: string) {
  sendAlerts("clickCharacterManagementButton", account);
  return clickButtonWithText(
    adbOptions,
    "Character",
    { x: 200, y: 100, width: 800, height: 600 },
    { x: 0, y: -50 }
  );
}
async function clickAccountButton(account: string) {
  sendAlerts("clickAccountButton", account);
  return clickButtonWithText(
    adbOptions,
    "Account",
    { x: 0, y: 0, width: 1280, height: 700 },
    { x: 0, y: -50 }
  );
}

async function clickSwitchAccountButton(account: string) {
  sendAlerts("clickSwitchAccountButton", account);
  return clickButtonWithText(adbOptions, "Switch Accounts", {
    x: 0,
    y: 0,
    width: 1280,
    height: 700,
  });
}

async function clickLoginButton(account: string) {
  sendAlerts("clickLoginButton", account);
  return clickButtonWithText(adbOptions, "Login", {
    x: 0,
    y: 0,
    width: 1280,
    height: 700,
  });
}
async function sendEscKey(account: string) {
  sendAlerts("sendEscKey", account);
  await runADBCommand(adbOptions, "shell input keyevent 111");
}
async function guessCurrentAccountFromScreen() {
  const texts = await ocrScreenArea(adbOptions, {
    x: 95,
    y: 290,
    width: 500,
    height: 60,
  });
  for (const t of texts) {
    for (const key in accounts) {
      if (t.text.includes(key)) {
        sendAlerts("guessCurrentAccountFromScreen currentAccount=" + key, key);
        console.log("guessCurrentAccountFromScreen", key);
        return key;
      }
    }
  }
  // const texts = await findImagePosition(
  //   adbOptions,
  //   `${path.resolve(__dirname, "./imgs/copy.png")}`
  // );

  // if (texts.isMatch) {
  //   await touchScreen(
  //     adbOptions,
  //     Math.round(texts.rect.x + texts.rect.width / 2),
  //     Math.round(texts.rect.y + texts.rect.height / 2)
  //   );
  //   await sleep(3000);
  //   const res = await exec(
  //     'powershell -command "Get-Clipboard"'
  //   );
  //   sendAlerts("guessCurrentAccountFromScreen currentAccount=" + res.stdout, res.stdout);
  //   return res.stdout;
  // }
  const allTexts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  // console.log("allTexts", allTexts);
  if (
    !allTexts.some((t) => t.text.includes("Power Merits")) &&
    !allTexts.some((t) => t.text.includes("Lord")) &&
    !allTexts.some((t) => t.text.includes("Achievements"))
  ) {
    sendAlerts(
      "guessCurrentAccountFromScreen something wrong when start app view, please check",
      "app",
      new Error("something wrong when start app view")
    );
    throw new Error("something wrong when start app view");
  }
  return "";
}

async function switchEmail(account: string, targetEmail: string) {
  await clickSettingButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);
  await clickAccountButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);
  await clickSwitchAccountButton(account);
  await sleepRandom(DEFAULT_WAIT_TIME);

  sendAlerts("Click Dropdown", account);
  await touchScreen(adbOptions, 937, 283);
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1200,
    height: 700,
  });
  let accountTexts = texts.find((t) => t.text === targetEmail);
  let retry = 0;
  while (!accountTexts && retry < 5) {
    sendAlerts("Retry to find accountTexts retry=" + retry, account);
    await scrollDown(640, 380);
    const texts = await ocrScreenArea(adbOptions, {
      x: 0,
      y: 0,
      width: 1200,
      height: 700,
    });
    accountTexts = texts.find((t) => t.text === targetEmail);
    retry++;
  }
  if (accountTexts) {
    sendAlerts("Click accountTexts" + JSON.stringify(accountTexts), account);
    await touchScreen(
      adbOptions,
      accountTexts.rect.x + accountTexts.rect.width / 2,
      accountTexts.rect.y + accountTexts.rect.height / 2
    );
    await sleep(DEFAULT_WAIT_TIME);
  } else {
    throw new Error("Cannot find account " + targetEmail);
  }

  await clickLoginButton(account);
  await waitForAvatarImage();
  await clickTopLeftAvatar(account);
  await sleep(DEFAULT_WAIT_TIME);
}

async function changeAccount(account: string, currentAccount: string) {
  sendAlerts("switchAccount " + account, currentAccount);
  const currentEmail = accounts[currentAccount]?.email;
  const targetEmail = accounts[account].email;
  sendAlerts(
    "currentEmail=" + currentEmail + " targetEmail=" + targetEmail,
    currentAccount
  );
  let needSwitchCharacter = account !== currentAccount;
  if (currentEmail !== targetEmail) {
    await switchEmail(currentAccount, targetEmail);
    const currentAccount1 = await guessCurrentAccountFromScreen();
    sendAlerts("currentAccount1=" + currentAccount1, currentAccount);
    needSwitchCharacter = account !== currentAccount1;
  }

  if (needSwitchCharacter) {
    await clickSettingButton(currentAccount);
    await sleepRandom(DEFAULT_WAIT_TIME);
    await clickCharacterManagementButton(currentAccount);
    await sleepRandom(DEFAULT_WAIT_TIME);
    const texts = await ocrScreenArea(adbOptions, {
      x: 256,
      y: 248,
      width: 773,
      height: 327,
    });

    const characterText = texts.find((t) => t.text.includes(account));
    if (!characterText) {
      sendAlerts("Character not found", currentAccount);
      process.exit(1);
    }
    sendAlerts("Click " + account, currentAccount);
    await touchScreen(
      adbOptions,
      characterText.rect.x + characterText.rect.width / 2,
      characterText.rect.y + characterText.rect.height / 2
    );
    await sleep(DEFAULT_WAIT_TIME);
    sendAlerts("Click confirm", currentAccount);
    await touchScreen(adbOptions, 745, 455);
    await sleep(DEFAULT_WAIT_TIME);
    await waitForAvatarImage();
  } else {
    await sendEscKey(currentAccount);
  }
}

async function persistAccountSettings(account: string) {
  await fsPromises.writeFile(
    "./accounts.json",
    JSON.stringify(accounts, null, 2),
    "utf-8"
  );
  sendAlerts("Account settings saved", account);
}

async function gatherProdRss(account: string) {
  sendAlerts("gatherProdRss", account);
  sendAlerts("Click mana", account);
  await touchScreen(adbOptions, 466, 436); // mana
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click stone", account);
  await touchScreen(adbOptions, 708, 261); // stone
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click gold", account);
  await touchScreen(adbOptions, 851, 360); // gold
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click wood", account);
  await touchScreen(adbOptions, 602, 537); // wood
  await sleep(DEFAULT_WAIT_TIME);
}
async function gatherClanRss(account: string) {
  sendAlerts("gatherClanRss", account);
  sendAlerts("Click bottom menu", account);
  await touchScreen(adbOptions, 1231, 664); // bottom menu
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click alliance", account);
  await touchScreen(adbOptions, 952, 667); // alliance
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  if (
    texts.some((t) =>
      t.text.toLocaleLowerCase().includes("join an alliance now")
    )
  ) {
    sendAlerts("You have been kicked out of the alliance", account);
    await touchScreen(adbOptions, 14, 26); // close
    await sleep(DEFAULT_WAIT_TIME);
    return;
  }

  sendAlerts("Click territory", account);
  await touchScreen(adbOptions, 922, 445); // territory
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click claim", account);
  await touchScreen(adbOptions, 1093, 224); // Claim
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
}
async function gatherDragonPoint(account: string) {
  sendAlerts("gatherDragonPoint", account);
  sendAlerts("Click campaign", account);
  await touchScreen(adbOptions, 861, 664); // Campaign
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click Behemoth trial", account);
  await touchScreen(adbOptions, 283, 316); // Behemoth trial
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click Exp", account);
  await touchScreen(adbOptions, 1210, 629); // Exp
  await sleep(DEFAULT_WAIT_TIME);
  sendAlerts("Click claim", account);
  await touchScreen(adbOptions, 618, 515); // Claim
  await sleep(DEFAULT_WAIT_TIME);
  await sendEscKey(account);
  await sleep(DEFAULT_WAIT_TIME);
}

async function clickMagnifyingGlass(account: string) {
  sendAlerts("Click magnifying glass", account);
  await touchScreen(adbOptions, 45, 551); // magnifying glass
}

async function gatherRss(
  rssName: "wood" | "gold" | "ore" | "mana",
  troopNumber: number,
  account: string
) {
  sendAlerts("gatherRss " + rssName, account);
  let pos = await findSubImageInCurrentScreen("./imgs/map.png", 65);
  if (pos !== null) {
    console.log("click map icon 1");
    await touchScreen(adbOptions, 48, 658);
    await sleep(DEFAULT_WAIT_TIME_LONG);
  }
  pos = await findSubImageInCurrentScreen("./imgs/map1.png", 20);
  if (pos !== null) {
    console.log("click map icon 2");
    await touchScreen(adbOptions, 48, 658);
    await sleep(DEFAULT_WAIT_TIME_LONG);
  }
  await clickMagnifyingGlass(account);
  await sleep(DEFAULT_WAIT_TIME);
  const button = RESOURCE_BUTTONS[rssName];
  if (button) {
    const texts = await ocrScreenArea(adbOptions, {
      x: 0,
      y: 0,
      width: 1200,
      height: 700,
    });
    const isSelected = texts.find(
      (t) => t.text.toLocaleLowerCase() === "more " + rssName + "."
    );
    if (!isSelected) {
      sendAlerts("Click " + rssName, account);
      await touchScreen(adbOptions, button.x, button.y);
      await sleep(DEFAULT_WAIT_TIME);
    }
    sendAlerts("Search Button", account);
    await touchScreen(adbOptions, button.x, button.y - 100);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click " + rssName + " node", account);
    await touchScreen(adbOptions, 640, 360);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click Gather", account);
    await touchScreen(adbOptions, 910, 520);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    sendAlerts("Click Create Legions", account);
    await touchScreen(adbOptions, 1004, 148);
    await sleep(DEFAULT_WAIT_TIME_LONG);

    let _troopNumber = troopNumber;
    if (_troopNumber > 10) {
      sendAlerts("Click refresh troop ", account);
      await touchScreen(adbOptions, 1226, 119);
      await sleep(DEFAULT_WAIT_TIME);
    }
    if (_troopNumber > 20) {
      sendAlerts("Click refresh troop ", account);
      await touchScreen(adbOptions, 1226, 119);
      await sleep(DEFAULT_WAIT_TIME);
    }
    _troopNumber = _troopNumber % 10;

    sendAlerts("Click troop " + _troopNumber, account);
    const troopButton = TROOP_BUTTONS["troop" + _troopNumber];
    if (troopButton) {
      await touchScreen(adbOptions, troopButton.x, troopButton.y);
      await sleep(DEFAULT_WAIT_TIME);
    } else {
      throw new Error("Troop button not found");
    }
    sendAlerts("Click March", account);
    await touchScreen(adbOptions, 1034, 620);
  }
}
async function clickButtonIfFound(imgPath: string) {
  const btnPos = await findSubImageInCurrentScreen(imgPath);
  if (btnPos) {
    // console.log(
    //   "clickButton",
    //   btnPos,
    //   Math.round(btnPos.x + btnPos.width / 2),
    //   Math.round(btnPos.y + btnPos.height / 2)
    // );
    await sleep(1000);
    await touchScreen(
      adbOptions,
      Math.round(btnPos.x + btnPos.width / 2),
      Math.round(btnPos.y + btnPos.height / 2)
    );
    await sleep(1000);
  }
}
async function doFarm(account: string, currentAccount: string) {
  await changeAccount(account, currentAccount);
  await sleepRandom(DEFAULT_WAIT_TIME);
  const accountSettings = accounts[account];
  let minGatheringTime = new Date().getTime() + 2 * 60 * 60 * 1000;

  accountSettings.nextCheckTime = new Date(minGatheringTime).toISOString();
  const rssTexts = await ocrScreenArea(adbOptions, {
    x: 615,
    y: 0,
    width: 600,
    height: 40,
  });
  accountSettings.stats = {
    gold: rssTexts[0]?.text || "",
    wood: rssTexts[1]?.text || "",
    ore: rssTexts[2]?.text || "",
    mana: rssTexts[3]?.text || "",
    gems: rssTexts[4]?.text || "",
  };

  await persistAccountSettings(account);
  if (accountSettings.nextAutoGatherTime < new Date().toISOString()) {
    if (accountSettings.gatherProdRss) await gatherProdRss(account);
    if (accountSettings.gatherClanRss) await gatherClanRss(account);
    if (accountSettings.gatherDragonPoint) await gatherDragonPoint(account);
    accountSettings.nextAutoGatherTime = new Date(
      new Date().getTime() + 6 * 60 * 60 * 1000
    ).toISOString();
    await persistAccountSettings(account);
  }
  sendAlerts("Click open queue list detail", account);
  await touchScreen(adbOptions, 1254, 290);
  await sleep(DEFAULT_WAIT_TIME);
  const texts = await ocrScreenArea(adbOptions, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  sendAlerts("Click close queue list detail", account);
  await touchScreen(adbOptions, 154, 290);
  await sleep(DEFAULT_WAIT_TIME_LONG);
  for await (const troop of accountSettings.troops) {
    const [name, resource, troopNumber] = troop;
    const hasTroop = texts.find((t) =>
      t.text.toLocaleLowerCase().includes(name.toLocaleLowerCase())
    );
    if (hasTroop) {
      continue;
    }
    sendAlerts("Gather rss " + JSON.stringify(troop), account);
    await gatherRss(resource, troopNumber, account);
    await sleepRandom(DEFAULT_WAIT_TIME_LONG);
  }
  for (const t of texts) {
    if (t.text.startsWith("Gathering ") || t.text.startsWith("Returning ")) {
      console.log("t.text", t.text);
      const timeStr = t.text.split(" ")[1];
      const timeParts = timeStr.split(":");
      if (timeParts.length === 3) {
        const gatheringTime =
          (parseInt(timeParts[0]) * 60 * 60 +
            parseInt(timeParts[1]) * 60 +
            parseInt(timeParts[2])) *
            1000 +
          Date.now();

        if (gatheringTime < minGatheringTime) {
          minGatheringTime = gatheringTime;
        }
      }
    }
  }
  // only revisit after 1 hour to prevent ban
  accountSettings.nextCheckTime = new Date(
    Math.max(minGatheringTime, Date.now() + 3600 * 1000)
  ).toISOString();
  sendAlerts("nextCheckTime=" + accountSettings.nextCheckTime, account);
  await persistAccountSettings(account);
  await clickButtonIfFound("./imgs/btn_sickle.png");
  await clickButtonIfFound("./imgs/btn_help.png");
  await clickTopLeftAvatar(account);
  sendAlerts("done farm", account);
}

async function main() {
  const isBotChecking = await fsPromises.exists("./isBotChecking.lock");
  if (isBotChecking) {
    await sendAlerts("isBotChecking.lock exists, exit", "app");
    await flushAlerts();
    process.exit(0);
  }
  const accountToRun = Object.keys(accounts).filter((key) => {
    return (
      accounts[key].enable &&
      accounts[key].nextCheckTime < new Date().toISOString()
    );
  });
  if (accountToRun.length === 0) {
    sendAlerts("No account to run", "app");
    await flushAlerts();
    process.exit(0);
  }
  await startApp();
  sendAlerts("accountToRun" + JSON.stringify(accountToRun), "app");
  try {
    await killGame();
  } catch (e) {
    sendAlerts("kill game error", "app", e);
  }
  await sleepRandom(DEFAULT_WAIT_TIME);
  console.log("start game");
  await startGame();

  await clickTopLeftAvatar("app");
  await sleepRandom(DEFAULT_WAIT_TIME);

  let currentAccount = await guessCurrentAccountFromScreen();
  sendAlerts("currentAccount=" + currentAccount, "app");
  let accountToFarm = "";
  if (currentAccount === "" || !accountToRun.includes(currentAccount)) {
    accountToFarm = accountToRun.pop()!;
  } else {
    accountToFarm = currentAccount;
    // remove currentAccount from accountToRun
    accountToRun.splice(accountToRun.indexOf(currentAccount), 1);
  }
  sendAlerts("accountToFarm=" + accountToFarm, "app");
  await doFarm(accountToFarm, currentAccount);
  currentAccount = await guessCurrentAccountFromScreen();
  while (accountToRun.length > 0) {
    sendAlerts("accountToRun" + JSON.stringify(accountToRun), "app");
    const nextAccount = accountToRun.pop()!;
    await doFarm(nextAccount, currentAccount);
    if (!currentAccount) {
      currentAccount = nextAccount;
    }
  }
  sendAlerts("all accounts done", "app");

  const availableAccounts = Object.entries(accounts)
    .filter(([key, value]) => {
      return value.enable;
    })
    .sort((a, b) => {
      return (
        new Date(a[1].nextCheckTime).getTime() -
        new Date(b[1].nextCheckTime).getTime()
      );
    });

  sendAlerts(
    availableAccounts
      .map(
        (a) =>
          a[0] +
          " next check =" +
          new Date(a[1].nextCheckTime).toLocaleString() +
          " stats=" +
          JSON.stringify(a[1].stats)
      )
      .join("\n"),
    "app"
  );
  const nextAccount = availableAccounts[0][0];

  if (nextAccount && nextAccount !== currentAccount) {
    sendAlerts("nextAccount=" + nextAccount, "app");
    await changeAccount(nextAccount, currentAccount);
    await sleepRandom(DEFAULT_WAIT_TIME);
  }
}

const to = setTimeout(async () => {
  sendAlerts("app timeout", "app");
  await killApp();
  process.exit(0);
}, 40 * 60 * 1000);

// async function testOcr() {
//   try {
//     const result = await ocrTextWithRect(
//       `${path.resolve(__dirname, "./tmp/tesssst.png")}`
//     );
//     console.log("OCR Result:", result);
//   } catch (error) {
//     console.error("Test failed:", error);
//   }
// }

// async function testCaptureScreen() {
//   const texts = await ocrScreenArea(adbOptions, {
//     x: 453,
//     y: 269,
//     width: 110,
//     height: 28,
//   });
//   console.log("texts", texts);
// }
// testOcr();
// testCaptureScreen();
// await waitForAvatarImage();
// findImagePosition(adbOptions, `${path.resolve(__dirname, "./imgs/copy.png")}`);
// guessCurrentAccountFromScreen()
// run //

await main();
await runADBCommand(adbOptions, "shell input keyevent KEYCODE_HOME");
await sleepRandom(DEFAULT_WAIT_TIME);
await killGame();
await sleepRandom(DEFAULT_WAIT_TIME);
await killApp();
clearTimeout(to);
await flushAlerts();
process.exit(0);
