// ——— 1. Вставь данные из Supabase: Settings → API ———
const SUPABASE_URL = "https://kgpvymvmvjtmblggnzrz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtncHZ5bXZtdmp0bWJsZ2duenJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzQ3OTksImV4cCI6MjA5NDUxMDc5OX0.E-DdvR4WC-7U485ojRKHKML3CUAUCI9XeOOHFF8___c";

const STORAGE_NAME_KEY = "messenger-user-name";
const DEMO_MESSAGES_KEY = "messenger-demo-messages";
const DEMO_PROFILES_KEY = "messenger-demo-profiles";
const ROOM_GENERAL = "general";
const MAX_NAME_LENGTH = 32;

// Участники для проверки личных чатов без базы (можно писать от их имени во 2-й вкладке)
const DEMO_PEERS = ["Аня", "Макс"];

const EMOJIS = [
  "😀", "😊", "🙂", "😂", "❤️", "👍", "🙏", "🔥",
  "✨", "💪", "☕", "🎉", "💚", "✅", "❌", "🤔",
  "😴", "🏃", "🚶", "🥗", "💤", "📌", "👋", "🌿",
];

let supabase = null;
let isDemoMode = false;
let currentUser = "";
let currentRoomId = ROOM_GENERAL;
let currentDmPeer = null;
let realtimeChannel = null;

const welcomeScreen = document.getElementById("welcome-screen");
const appEl = document.getElementById("app");
const welcomeForm = document.getElementById("welcome-form");
const welcomeNameInput = document.getElementById("welcome-name");
const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const chatTitle = document.getElementById("chat-title");
const chatSubtitle = document.getElementById("chat-subtitle");
const dmListEl = document.getElementById("dm-list");
const configWarning = document.getElementById("config-warning");
const emojiPanel = document.getElementById("emoji-panel");
const emojiBtn = document.getElementById("emoji-btn");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuBtn = document.getElementById("menu-btn");

function isSupabaseConfigured() {
  return (
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("ВАШ_ПРОЕКТ") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("ВАШ_ANON")
  );
}

function dmRoomId(nameA, nameB) {
  return "dm--" + [nameA, nameB].sort((a, b) => a.localeCompare(b, "ru")).join("--");
}

function formatTime(isoOrDate) {
  const d = new Date(isoOrDate);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function closeSidebarMobile() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("visible");
}

function openSidebarMobile() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("visible");
}

function initEmojiPanel() {
  emojiPanel.innerHTML = "";
  EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      messageInput.value += emoji;
      messageInput.focus();
    });
    emojiPanel.appendChild(btn);
  });
}

emojiBtn.addEventListener("click", () => {
  emojiPanel.classList.toggle("hidden");
});

menuBtn.addEventListener("click", openSidebarMobile);
sidebarBackdrop.addEventListener("click", closeSidebarMobile);

messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 100) + "px";
});

function demoGetMessages() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_MESSAGES_KEY) || "[]");
  } catch {
    return [];
  }
}

function demoSaveMessages(list) {
  localStorage.setItem(DEMO_MESSAGES_KEY, JSON.stringify(list));
}

function demoGetProfiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_PROFILES_KEY) || "[]");
    const names = new Set([...DEMO_PEERS, ...saved]);
    return [...names].sort((a, b) => a.localeCompare(b, "ru")).map((name) => ({ name }));
  } catch {
    return DEMO_PEERS.map((name) => ({ name }));
  }
}

function demoSaveProfile(name) {
  const profiles = demoGetProfiles().map((p) => p.name);
  if (!profiles.includes(name)) {
    profiles.push(name);
    localStorage.setItem(DEMO_PROFILES_KEY, JSON.stringify(profiles));
  }
}

function seedDemoMessagesIfEmpty() {
  if (demoGetMessages().length > 0) return;
  const now = Date.now();
  demoSaveMessages([
    {
      id: "demo-1",
      room_id: ROOM_GENERAL,
      author_name: "Аня",
      text: "Привет! Это демо-режим — можно тестировать без Supabase 👋",
      created_at: new Date(now - 600000).toISOString(),
    },
    {
      id: "demo-2",
      room_id: ROOM_GENERAL,
      author_name: "Макс",
      text: "Открой вторую вкладку под другим именем — увидишь общий чат.",
      created_at: new Date(now - 300000).toISOString(),
    },
  ]);
}

async function registerProfile(name) {
  if (isDemoMode) {
    demoSaveProfile(name);
    return;
  }
  const { error } = await supabase.from("profiles").upsert(
    { name, last_seen: new Date().toISOString() },
    { onConflict: "name" }
  );
  if (error) console.error("profiles:", error);
}

async function loadProfiles() {
  let data;
  if (isDemoMode) {
    data = demoGetProfiles();
  } else {
    const result = await supabase.from("profiles").select("name").order("name");
    if (result.error) {
      console.error(result.error);
      return;
    }
    data = result.data;
  }

  dmListEl.innerHTML = "";
  const others = (data || []).filter((p) => p.name !== currentUser);

  if (others.length === 0) {
    dmListEl.innerHTML =
      '<p class="chat-list-label" style="text-transform:none;font-weight:400;padding:8px 12px">Пока никого кроме тебя — пригласи друзей по ссылке</p>';
    return;
  }

  others.forEach((profile) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-item";
    btn.dataset.room = dmRoomId(currentUser, profile.name);
    btn.dataset.peer = profile.name;
    btn.innerHTML = `
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-text">
        <span class="chat-item-title">${escapeHtml(profile.name)}</span>
        <span class="chat-item-sub">Личные сообщения</span>
      </span>
    `;
    btn.addEventListener("click", () => selectChat(btn));
    dmListEl.appendChild(btn);
  });
}

function setActiveChatItem(activeBtn) {
  document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
  activeBtn.classList.add("active");
}

async function selectChat(btn) {
  const roomId = btn.dataset.room;
  const peer = btn.dataset.peer || null;

  currentRoomId = roomId;
  currentDmPeer = peer;

  const demoHint = isDemoMode ? " · демо-режим" : "";

  if (roomId === ROOM_GENERAL) {
    chatTitle.textContent = "Общий чат";
    chatSubtitle.textContent = "До 10 человек · только текст и эмодзи" + demoHint;
  } else {
    chatTitle.textContent = peer;
    chatSubtitle.textContent = "Личная переписка" + demoHint;
  }

  setActiveChatItem(btn);
  closeSidebarMobile();
  await loadMessages();
  subscribeToRoom();
  messageInput.focus();
}

async function loadMessages() {
  messagesEl.innerHTML = '<p class="messages-empty">Загрузка...</p>';

  if (isDemoMode) {
    const data = demoGetMessages()
      .filter((m) => m.room_id === currentRoomId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    renderMessages(data);
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("room_id", currentRoomId)
    .order("created_at", { ascending: true });

  if (error) {
    messagesEl.innerHTML = `<p class="messages-empty">Ошибка: ${escapeHtml(error.message)}</p>`;
    return;
  }

  renderMessages(data || []);
}

function renderMessages(list) {
  messagesEl.innerHTML = "";

  if (list.length === 0) {
    messagesEl.innerHTML =
      '<p class="messages-empty">Пока нет сообщений.<br>Напиши первым 👋</p>';
    return;
  }

  list.forEach((msg) => {
    const isMe = msg.author_name === currentUser;
    const el = document.createElement("div");
    el.className = "msg " + (isMe ? "msg--me" : "msg--other");

    const authorHtml =
      currentRoomId === ROOM_GENERAL && !isMe
        ? `<span class="msg-author">${escapeHtml(msg.author_name)}</span>`
        : "";

    el.innerHTML = `
      ${authorHtml}
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
      <time class="msg-time">${formatTime(msg.created_at)}</time>
    `;
    messagesEl.appendChild(el);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function subscribeToRoom() {
  if (isDemoMode) return;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel("room:" + currentRoomId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "room_id=eq." + currentRoomId,
      },
      () => loadMessages()
    )
    .subscribe();
}

async function sendMessage(text) {
  if (isDemoMode) {
    const list = demoGetMessages();
    list.push({
      id: "demo-" + Date.now(),
      room_id: currentRoomId,
      author_name: currentUser,
      text,
      created_at: new Date().toISOString(),
    });
    demoSaveMessages(list);
    return true;
  }

  const { error } = await supabase.from("messages").insert({
    room_id: currentRoomId,
    author_name: currentUser,
    text,
  });

  if (error) {
    alert("Не удалось отправить: " + error.message);
    return false;
  }
  return true;
}

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  if (!isDemoMode && !supabase) return;

  const ok = await sendMessage(text);
  if (ok) {
    messageInput.value = "";
    messageInput.style.height = "auto";
    emojiPanel.classList.add("hidden");
    await loadMessages();
  }
});

welcomeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = welcomeNameInput.value.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return;

  currentUser = name;
  localStorage.setItem(STORAGE_NAME_KEY, name);

  await registerProfile(name);
  startApp();
});

document.querySelector('[data-room="general"]').addEventListener("click", function () {
  selectChat(this);
});

async function startApp() {
  document.getElementById("current-user-label").textContent = currentUser;
  welcomeScreen.classList.add("hidden");
  appEl.classList.remove("hidden");

  await loadProfiles();
  await selectChat(document.querySelector('[data-room="general"]'));

  if (!isDemoMode) {
    setInterval(async () => {
      await registerProfile(currentUser);
      await loadProfiles();
    }, 60000);
  }
}

function showDemoBanner() {
  configWarning.textContent =
    "Демо-режим: данные только в этом браузере. Для чата с друзьями подключи Supabase в script.js";
  configWarning.classList.remove("hidden");
}

async function init() {
  initEmojiPanel();
  isDemoMode = !isSupabaseConfigured();

  if (isDemoMode) {
    showDemoBanner();
    seedDemoMessagesIfEmpty();
  } else {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  const savedName = localStorage.getItem(STORAGE_NAME_KEY);
  if (savedName) {
    currentUser = savedName.trim().slice(0, MAX_NAME_LENGTH);
    await registerProfile(currentUser);
    startApp();
  } else {
    welcomeScreen.classList.remove("hidden");
  }
}

init();
