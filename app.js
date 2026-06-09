"use strict";

// ASTRA IDLE KNIGHT v1
// 외부 라이브러리 없이 상태, 전투 루프, 화면 렌더링을 나누어 작성한 다크 판타지 방치 액션 RPG.

const SAVE_KEY = "ASTRA_IDLE_KNIGHT_SAVE_V1";
const TICK_MS = 1000;
const AUTO_SAVE_MS = 5000;
const MAX_LOGS = 5;
const SKILL_COOLDOWN = 8;       // 스킬 재사용 대기(초)
const BOSS_TIME_LIMIT = 30;     // 보스전 제한 시간(초)
const ULT_GAIN_PER_HIT = 6;     // 타격당 궁극기 게이지 상승량

const MONSTER_NAMES = [
  "그림자 늑대",
  "타락한 기사",
  "잿빛 망령",
  "심연 슬라임",
  "검은 해골병"
];

let state = createInitialState();
let lastTickTime = Date.now();

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadGame();
  ensureMonster();
  render();

  // 1초마다 자동 전투를 진행합니다.
  setInterval(gameLoop, TICK_MS);

  // 전투 중 상태가 바뀌므로 주기적으로 localStorage에 저장합니다.
  setInterval(saveGame, AUTO_SAVE_MS);
});

// -----------------------------
// 상태 생성과 저장
// -----------------------------

function createInitialState() {
  return {
    screen: "home",
    stage: 1,
    level: 1,
    exp: 0,
    expToNext: 30,
    gold: 0,
    ultimateGauge: 0,
    skillCooldown: 0,
    lastSavedAt: null,
    hero: {
      hp: 100,
      maxHp: 100,
      attack: 10,
      attackUpgrade: 0,
      hpUpgrade: 0,
      skillLevel: 1,
      skillUpgrade: 0
    },
    monster: null,
    boss: {
      active: false,
      name: "심연의 문지기",
      hp: 0,
      maxHp: 0,
      attack: 0,
      rewardGold: 0,
      rewardExp: 0,
      timeLeft: 0,
      timeLimit: BOSS_TIME_LIMIT
    },
    logs: ["게임을 시작했습니다."]
  };
}

function loadGame() {
  const savedText = localStorage.getItem(SAVE_KEY);

  if (!savedText) {
    return;
  }

  try {
    const saved = JSON.parse(savedText);
    const base = createInitialState();

    // 저장 데이터가 일부만 있어도 기본값과 섞어서 안전하게 불러옵니다.
    state = {
      ...base,
      ...saved,
      hero: { ...base.hero, ...saved.hero },
      boss: { ...base.boss, ...saved.boss },
      logs: Array.isArray(saved.logs) ? saved.logs.slice(0, MAX_LOGS) : base.logs
    };

    // 구버전 저장본 보정: 보스가 진행 중인데 타이머 값이 없으면 새로 채웁니다.
    if (state.boss.active && (!state.boss.timeLeft || state.boss.timeLeft <= 0)) {
      state.boss.timeLeft = state.boss.timeLimit || BOSS_TIME_LIMIT;
    }
  } catch (error) {
    console.warn("저장 데이터를 불러오지 못했습니다.", error);
    state = createInitialState();
  }
}

function saveGame() {
  state.lastSavedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  renderSaveText();
}

function resetSave() {
  const ok = window.confirm("저장 데이터를 초기화할까요?");

  if (!ok) {
    return;
  }

  localStorage.removeItem(SAVE_KEY);
  state = createInitialState();
  ensureMonster();
  addLog("저장 데이터가 초기화되었습니다.");
  render();
}

// -----------------------------
// 전투 루프
// -----------------------------

function gameLoop() {
  const now = Date.now();
  const elapsedSeconds = Math.max(1, Math.round((now - lastTickTime) / 1000));
  lastTickTime = now;

  reduceCooldowns(elapsedSeconds);

  if (state.boss.active) {
    runBossCombat(elapsedSeconds);
  } else {
    runMonsterCombat();
  }

  render();
}

function runMonsterCombat() {
  ensureMonster();

  const monster = state.monster;
  const damage = getHeroAttack();

  applyDamage(monster, damage);
  logHit("기본 공격", monster, damage);
  triggerAttackFx();

  if (monster.hp <= 0) {
    winMonster(monster);
    return;
  }

  if (damageHero(monster.attack)) {
    reviveHero();
  }
}

function runBossCombat(elapsedSeconds) {
  const boss = state.boss;

  // 제한 시간 감소 → 0이면 시간 초과 패배.
  boss.timeLeft = Math.max(0, boss.timeLeft - elapsedSeconds);

  if (boss.timeLeft <= 0) {
    loseBoss("시간 초과");
    return;
  }

  const damage = getHeroAttack();
  applyDamage(boss, damage);
  logHit("보스 공격", boss, damage);
  triggerAttackFx();

  if (boss.hp <= 0) {
    winBoss();
    return;
  }

  if (damageHero(boss.attack)) {
    loseBoss("패배");
  }
}

// 대상의 체력을 깎고 궁극기 게이지를 채웁니다.
function applyDamage(target, amount) {
  target.hp = Math.max(0, target.hp - amount);
  state.ultimateGauge = clamp(state.ultimateGauge + ULT_GAIN_PER_HIT, 0, 100);
}

// 기사가 피해를 입습니다. 쓰러지면 true 를 반환합니다(회복/패배 처리는 호출부가 담당).
function damageHero(amount) {
  state.hero.hp = Math.max(0, state.hero.hp - amount);
  return state.hero.hp <= 0;
}

function reviveHero() {
  state.hero.hp = state.hero.maxHp;
  state.ultimateGauge = Math.max(0, state.ultimateGauge - 15);
  addLog("기사가 쓰러져 회복했습니다.");
}

function winMonster(monster) {
  state.gold += monster.rewardGold;
  gainExp(monster.rewardExp);
  addLog(`${monster.name} 처치: 골드 ${monster.rewardGold}, 경험치 ${monster.rewardExp}`);
  state.monster = null;
  ensureMonster();
}

function winBoss() {
  const rewardGold = state.boss.rewardGold;
  const rewardExp = state.boss.rewardExp;

  state.stage += 1;
  state.gold += rewardGold;
  gainExp(rewardExp);
  state.boss.active = false;
  state.boss.hp = 0;
  state.boss.timeLeft = 0;
  state.hero.hp = state.hero.maxHp;
  state.monster = null;
  ensureMonster();
  addLog(`보스 승리: 스테이지 ${state.stage} 진입 (골드 ${rewardGold})`);
  saveGame();
}

function loseBoss(reason) {
  state.boss.active = false;
  state.boss.hp = 0;
  state.boss.timeLeft = 0;
  state.hero.hp = state.hero.maxHp;
  addLog(`보스전 ${reason}: 일반 전투로 복귀합니다.`);
  saveGame();
}

function ensureMonster() {
  if (state.monster && state.monster.hp > 0) {
    return;
  }

  const nameIndex = (state.stage + state.level + Math.floor(Date.now() / 1000)) % MONSTER_NAMES.length;
  const maxHp = Math.floor(45 + state.stage * 18 + state.level * 7);

  state.monster = {
    name: MONSTER_NAMES[nameIndex],
    hp: maxHp,
    maxHp,
    attack: Math.floor(5 + state.stage * 2 + state.level * 1.2),
    rewardGold: Math.floor(14 + state.stage * 5 + state.level * 2),
    rewardExp: Math.floor(10 + state.stage * 3 + state.level * 2)
  };

  addLog(`${state.monster.name} 등장`);
}

function startBossChallenge() {
  if (state.boss.active) {
    return;
  }

  const maxHp = Math.floor(160 + state.stage * 95 + state.level * 20);

  state.screen = "boss";
  state.hero.hp = state.hero.maxHp;
  state.boss = {
    active: true,
    name: `스테이지 ${state.stage} 보스`,
    hp: maxHp,
    maxHp,
    attack: Math.floor(12 + state.stage * 4 + state.level * 1.5),
    rewardGold: Math.floor(80 + state.stage * 35),
    rewardExp: Math.floor(65 + state.stage * 22),
    timeLeft: BOSS_TIME_LIMIT,
    timeLimit: BOSS_TIME_LIMIT
  };

  addLog(`${state.boss.name} 도전 시작 (제한 ${BOSS_TIME_LIMIT}초)`);
  saveGame();
  render();
}

// -----------------------------
// 성장과 버튼 액션
// -----------------------------

function gainExp(amount) {
  state.exp += amount;

  while (state.exp >= state.expToNext) {
    state.exp -= state.expToNext;
    state.level += 1;
    state.expToNext = Math.floor(state.expToNext * 1.35 + 12);
    state.hero.attack += 3;
    state.hero.maxHp += 18;
    state.hero.hp = state.hero.maxHp;
    addLog(`레벨업: Lv.${state.level}`);
  }
}

// 골드 소모형 강화의 공통 처리.
function buyUpgrade(cost, label, applyFn) {
  if (state.gold < cost) {
    addLog(`${label} 골드가 부족합니다.`);
    render();
    return;
  }

  state.gold -= cost;
  applyFn();
  addLog(`${label} 완료.`);
  saveGame();
  render();
}

function upgradeAttack() {
  buyUpgrade(getAttackUpgradeCost(), "공격력 강화", () => {
    state.hero.attack += 5;
    state.hero.attackUpgrade += 1;
  });
}

function upgradeHp() {
  buyUpgrade(getHpUpgradeCost(), "체력 강화", () => {
    state.hero.maxHp += 30;
    state.hero.hp = state.hero.maxHp;
    state.hero.hpUpgrade += 1;
  });
}

function upgradeSkill() {
  buyUpgrade(getSkillUpgradeCost(), "스킬 강화", () => {
    state.hero.skillLevel += 1;
    state.hero.skillUpgrade += 1;
  });
}

// 스킬과 궁극기는 게이트 조건만 다르고 흐름이 같아 하나로 묶었습니다.
function performManualAttack(kind) {
  if (kind === "skill" && state.skillCooldown > 0) {
    addLog(`스킬 대기 중: ${state.skillCooldown}초`);
    render();
    return;
  }

  if (kind === "ultimate" && state.ultimateGauge < 100) {
    addLog("궁극기 게이지가 부족합니다.");
    render();
    return;
  }

  const target = getCurrentTarget();

  if (!target) {
    render();
    return;
  }

  let damage;

  if (kind === "skill") {
    damage = Math.floor(getHeroAttack() * getSkillMultiplier());
    state.skillCooldown = SKILL_COOLDOWN;
    applyDamage(target, damage);
    logHit("스킬", target, damage);
    triggerSkillFx();
  } else {
    damage = Math.floor(getHeroAttack() * getUltimateMultiplier());
    state.ultimateGauge = 0;
    applyDamage(target, damage);
    logHit("궁극기", target, damage);
    triggerUltimateFx();
  }

  checkTargetAfterManualAttack(target);
  saveGame();
  render();
}

function useSkill() {
  performManualAttack("skill");
}

function useUltimate() {
  performManualAttack("ultimate");
}

function checkTargetAfterManualAttack(target) {
  if (target.hp > 0) {
    return;
  }

  if (state.boss.active && target === state.boss) {
    winBoss();
    return;
  }

  winMonster(target);
}

function reduceCooldowns(seconds) {
  state.skillCooldown = Math.max(0, state.skillCooldown - seconds);
}

function getCurrentTarget() {
  if (state.boss.active) {
    return state.boss;
  }

  ensureMonster();
  return state.monster;
}

function getHeroAttack() {
  return state.hero.attack;
}

function getSkillMultiplier() {
  return 2.5 + 0.5 * state.hero.skillLevel; // Lv.1 = 3.0배
}

function getUltimateMultiplier() {
  return 7 + state.hero.skillLevel; // Lv.1 = 8.0배 (스킬 강화로 함께 상승)
}

function getAttackUpgradeCost() {
  return 50 + state.hero.attackUpgrade * 35;
}

function getHpUpgradeCost() {
  return 45 + state.hero.hpUpgrade * 30;
}

function getSkillUpgradeCost() {
  return 60 + state.hero.skillUpgrade * 40;
}

function addLog(message) {
  state.logs.unshift(message);
  state.logs = state.logs.slice(0, MAX_LOGS);
}

function logHit(sourceName, target, amount) {
  addLog(`${sourceName}: ${target.name}에게 ${amount} 피해`);
}

// -----------------------------
// 전투 이펙트 (CSS 클래스 토글)
// -----------------------------

function pulseClass(element, className, durationMs) {
  if (!element) {
    return;
  }

  element.classList.remove(className);
  void element.offsetWidth; // 리플로우로 애니메이션 재시작
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), durationMs);
}

function getEnemyBox() {
  return state.boss.active ? el.bossBox : el.monsterBox;
}

// 자동 공격: 기사가 앞으로 살짝 전진 + 적 피격 흔들림.
function triggerAttackFx() {
  pulseClass(el.heroBox, "is-attacking", 320);
  pulseClass(getEnemyBox(), "is-hit", 280);
}

// 스킬: 달빛 베기 + 전진 + 흔들림.
function triggerSkillFx() {
  const box = getEnemyBox();
  pulseClass(el.heroBox, "is-attacking", 320);
  pulseClass(box, "is-hit", 280);

  if (box) {
    pulseClass(box.querySelector(".fx-slash"), "show-skill", 360);
  }
}

// 궁극기: 전체 화면 달빛 폭발 + 전진 + 흔들림.
function triggerUltimateFx() {
  pulseClass(el.ultFx, "play", 620);
  pulseClass(el.heroBox, "is-attacking", 320);
  pulseClass(getEnemyBox(), "is-hit", 280);
}

// -----------------------------
// 렌더링
// -----------------------------

function render() {
  renderScreens();
  renderTopStatus();
  renderHome();
  renderBattle();
  renderUpgrade();
  renderBoss();
  renderLogs();
  renderSaveText();
}

function renderScreens() {
  document.querySelectorAll("[data-screen-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.screenPanel === state.screen);
  });

  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === state.screen);
  });
}

function renderTopStatus() {
  setText("stageText", state.stage);
  setText("levelText", state.level);
  setText("goldText", formatNumber(state.gold));
  setText("expText", `${state.exp} / ${state.expToNext}`);
  setBar("expBarFill", state.exp, state.expToNext);
  setText("heroHpMiniText", `${state.hero.hp} / ${state.hero.maxHp}`);
  setText("ultimateMiniText", `${state.ultimateGauge}%`);
  setBar("heroHpMiniBar", state.hero.hp, state.hero.maxHp);
  setBar("ultimateMiniBar", state.ultimateGauge, 100);
}

function renderHome() {
  setText("homeSummary", `스테이지 ${state.stage}, Lv.${state.level}, 공격력 ${state.hero.attack}`);
  setText("homeAttackText", state.hero.attack);
  setText("homeMaxHpText", state.hero.maxHp);
  setText("homeSkillLevelText", state.hero.skillLevel);
  setText("homeAttackUpgradeText", state.hero.attackUpgrade);
  setText("homeHpUpgradeText", state.hero.hpUpgrade);
}

function renderBattle() {
  ensureMonster();

  setText("battleHeroStats", `공격력 ${state.hero.attack}`);
  setText("battleHeroHpText", `${state.hero.hp} / ${state.hero.maxHp}`);
  setBar("battleHeroHpBar", state.hero.hp, state.hero.maxHp);

  setText("monsterNameText", state.monster.name);
  setText("monsterStatsText", `공격력 ${state.monster.attack}`);
  setText("monsterHpText", `${state.monster.hp} / ${state.monster.maxHp}`);
  setBar("monsterHpBar", state.monster.hp, state.monster.maxHp);

  setText("battleModeText", state.boss.active ? "보스전 진행 중" : "자동 전투");
  updateSkillButtons();
}

function renderUpgrade() {
  const attackCost = getAttackUpgradeCost();
  const hpCost = getHpUpgradeCost();
  const skillCost = getSkillUpgradeCost();

  setText("upgradeAttackText", state.hero.attack);
  setText("upgradeHpText", state.hero.maxHp);
  setText("upgradeSkillText", state.hero.skillLevel);
  setText("attackCostText", `필요 골드 ${attackCost}`);
  setText("hpCostText", `필요 골드 ${hpCost}`);
  setText("skillCostText", `필요 골드 ${skillCost}`);
  setText("skillUpgradeInfo", `스킬 ${getSkillMultiplier().toFixed(1)}배 → ${(getSkillMultiplier() + 0.5).toFixed(1)}배`);

  if (el.attackUpgradeButton) el.attackUpgradeButton.disabled = state.gold < attackCost;
  if (el.hpUpgradeButton) el.hpUpgradeButton.disabled = state.gold < hpCost;
  if (el.skillUpgradeButton) el.skillUpgradeButton.disabled = state.gold < skillCost;
}

function renderBoss() {
  const boss = state.boss;

  setText("bossNameText", boss.active ? boss.name : "심연의 문지기");
  setText("bossStatusText", boss.active ? "보스전 진행 중" : `승리하면 스테이지 ${state.stage + 1}로 이동`);
  setText("bossHpText", boss.active ? `${boss.hp} / ${boss.maxHp}` : "0 / 0");
  setBar("bossHpBar", boss.active ? boss.hp : 0, boss.active ? boss.maxHp : 1);

  const shownTime = boss.active ? boss.timeLeft : boss.timeLimit;
  setText("bossTimerText", `${Math.max(0, Math.ceil(shownTime))}s`);
  setBar("bossTimerBar", boss.active ? boss.timeLeft : boss.timeLimit, boss.timeLimit);

  if (el.bossTimerWrap) {
    el.bossTimerWrap.style.visibility = boss.active ? "visible" : "hidden";
    el.bossTimerWrap.classList.toggle("urgent", boss.active && boss.timeLeft <= 10);
  }

  if (el.startBossButton) el.startBossButton.disabled = boss.active;
  updateSkillButtons();
}

function renderLogs() {
  if (!el.logList) {
    return;
  }

  el.logList.innerHTML = "";

  state.logs.forEach((log) => {
    const item = document.createElement("li");
    item.textContent = log;
    el.logList.appendChild(item);
  });
}

function renderSaveText() {
  if (!el.saveText) {
    return;
  }

  if (!state.lastSavedAt) {
    el.saveText.textContent = "자동 저장 대기";
    return;
  }

  const time = new Date(state.lastSavedAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  el.saveText.textContent = `자동 저장 ${time}`;
}

function updateSkillButtons() {
  const cooldownText = state.skillCooldown > 0 ? `스킬 ${state.skillCooldown}s` : "스킬";
  const ultimateReady = state.ultimateGauge >= 100;

  setText("skillButton", cooldownText);
  setText("bossSkillButton", cooldownText);

  if (el.skillButton) el.skillButton.disabled = state.skillCooldown > 0;
  if (el.bossSkillButton) el.bossSkillButton.disabled = state.skillCooldown > 0;
  if (el.ultimateButton) el.ultimateButton.disabled = !ultimateReady;
  if (el.bossUltimateButton) el.bossUltimateButton.disabled = !ultimateReady;
}

// -----------------------------
// 이벤트 연결
// -----------------------------

function cacheElements() {
  [
    "attackCostText", "attackUpgradeButton", "attackUpgradeInfo",
    "battleHeroHpBar", "battleHeroHpText", "battleHeroStats", "battleModeText",
    "bossBattleButton", "bossBox", "bossHpBar", "bossHpText", "bossNameText",
    "bossSkillButton", "bossStatusText", "bossTimerBar", "bossTimerText", "bossTimerWrap",
    "bossUltimateButton", "expBarFill", "expText", "goldText",
    "heroBox", "heroHpMiniBar", "heroHpMiniText",
    "homeAttackText", "homeAttackUpgradeText", "homeBattleButton", "homeBossButton",
    "homeHpUpgradeText", "homeMaxHpText", "homeSkillLevelText", "homeSummary", "homeUpgradeButton",
    "hpCostText", "hpUpgradeButton", "hpUpgradeInfo",
    "levelText", "logList", "monsterBox", "monsterHpBar", "monsterHpText",
    "monsterNameText", "monsterStatsText", "resetSaveButton", "saveText",
    "skillButton", "skillCostText", "skillUpgradeButton", "skillUpgradeInfo",
    "stageText", "startBossButton", "ultFx", "ultimateButton",
    "ultimateMiniBar", "ultimateMiniText", "upgradeAttackText", "upgradeHpText", "upgradeSkillText"
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => setScreen(button.dataset.screen));
  });

  bindClick("homeBattleButton", () => setScreen("battle"));
  bindClick("homeUpgradeButton", () => setScreen("upgrade"));
  bindClick("homeBossButton", () => setScreen("boss"));
  bindClick("bossBattleButton", () => setScreen("battle"));

  bindClick("attackUpgradeButton", upgradeAttack);
  bindClick("hpUpgradeButton", upgradeHp);
  bindClick("skillUpgradeButton", upgradeSkill);

  bindClick("skillButton", useSkill);
  bindClick("bossSkillButton", useSkill);
  bindClick("ultimateButton", useUltimate);
  bindClick("bossUltimateButton", useUltimate);

  bindClick("startBossButton", startBossChallenge);
  bindClick("resetSaveButton", resetSave);
}

function bindClick(id, handler) {
  if (el[id]) {
    el[id].addEventListener("click", handler);
  }
}

function setScreen(screenName) {
  state.screen = screenName;
  saveGame();
  render();
}

// -----------------------------
// 작은 유틸 함수
// -----------------------------

function setText(id, value) {
  const target = el[id] || document.getElementById(id);

  if (target) {
    target.textContent = value;
  }
}

function setBar(id, current, max) {
  const target = el[id] || document.getElementById(id);
  const percent = max <= 0 ? 0 : clamp((current / max) * 100, 0, 100);

  if (target) {
    target.style.width = `${percent}%`;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  return Number(value).toLocaleString("ko-KR");
}
