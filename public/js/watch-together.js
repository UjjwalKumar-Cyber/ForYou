(() => {
  const roomLinkInput = document.querySelector("#watch-room-link");
  const copyLinkButton = document.querySelector("#copy-watch-link");
  const nameInput = document.querySelector("#watch-name");
  const statusText = document.querySelector("#watch-status");
  const videoForm = document.querySelector("#watch-video-form");
  const videoInput = document.querySelector("#watch-url");
  const addWatchVideosButton = document.querySelector("#add-watch-videos");
  const playlistElement = document.querySelector("#watch-playlist");
  const savePlaylistButton = document.querySelector("#save-watch-playlist");
  const loadPlaylistButton = document.querySelector("#load-watch-playlist");
  const chatList = document.querySelector("#watch-chat-list");
  const chatForm = document.querySelector("#watch-chat-form");
  const chatInput = document.querySelector("#watch-chat-input");
  const youtubeElement = document.querySelector("#youtube-player");
  const instagramFrame = document.querySelector("#instagram-player");
  const emptyState = document.querySelector("#watch-empty");
  const nowTitle = document.querySelector("#watch-now-title");
  const syncStatus = document.querySelector("#watch-sync-status");
  const syncNowButton = document.querySelector("#sync-now");
  const viewersElement = document.querySelector("#watch-viewers");
  const toastStack = document.querySelector("#watch-toast-stack");

  let socket = null;
  let roomId = "";
  let player = null;
  let playerReady = false;
  let youtubeApiPromise = null;
  let latestState = null;
  let suppressPlayerEventsUntil = 0;
  let lastKnownTime = 0;
  let lastLoadedVideoId = "";
  let viewerKey = "";
  let accountUsername = "";
  let draggedPlaylistIndex = -1;

  function setStatus(message, type = "neutral") {
    statusText.textContent = message;
    statusText.dataset.type = type;
  }

  function makeRoomId() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(7);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  function getRoomId() {
    const match = window.location.pathname.match(/^\/watch\/([a-zA-Z0-9_-]{4,48})\/?$/);
    return match ? match[1] : makeRoomId();
  }

  function getDisplayName() {
    return String(nameInput.value || "").trim().slice(0, 28) || "Someone";
  }

  function cleanUsername(input) {
    return String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 40);
  }

  function participantLabel(participant = {}) {
    const displayName = String(participant.displayName || "").trim();
    const username = cleanUsername(participant.username);

    if (displayName && username && displayName.toLowerCase() !== username) {
      return `${displayName} (@${username})`;
    }

    if (username) {
      return `@${username}`;
    }

    return displayName || "Someone";
  }

  function getViewerKey() {
    let value = window.localStorage.getItem("foryou_watch_viewer_key") || "";

    if (!/^[a-zA-Z0-9_-]{8,48}$/.test(value)) {
      value = makeRoomId() + makeRoomId();
      window.localStorage.setItem("foryou_watch_viewer_key", value);
    }

    return value;
  }

  function roomUrl() {
    return `${window.location.origin}/watch/${encodeURIComponent(roomId)}`;
  }

  function updateRoomLink() {
    roomLinkInput.value = roomUrl();
  }

  function showToast(message) {
    const node = document.createElement("div");
    node.className = "watch-toast";
    node.textContent = message;
    toastStack.append(node);

    window.setTimeout(() => {
      node.classList.add("is-leaving");
      window.setTimeout(() => node.remove(), 220);
    }, 2600);
  }

  function renderViewers(viewers = []) {
    if (!viewers.length) {
      viewersElement.textContent = "Waiting for someone to join...";
      return;
    }

    viewersElement.replaceChildren(
      ...viewers.map((viewer) => {
        const item = document.createElement("span");
        item.textContent = participantLabel(viewer);
        return item;
      })
    );
  }

  function sourceLabel(source, index) {
    if (!source) {
      return `Video ${index + 1}`;
    }

    if (source.provider === "youtube") {
      return `YouTube ${source.videoId}`;
    }

    if (source.provider === "instagram") {
      return `Instagram ${source.shortcode}`;
    }

    return `Video ${index + 1}`;
  }

  function renderPlaylist() {
    const playlist = latestState && Array.isArray(latestState.playlist) ? latestState.playlist : [];
    const currentIndex = latestState ? Number(latestState.currentIndex) || 0 : 0;

    if (!playlist.length) {
      playlistElement.replaceChildren();
      playlistElement.textContent = "No videos yet. Paste links above to start a shared queue.";
      return;
    }

    playlistElement.replaceChildren(
      ...playlist.map((source, index) => {
        const item = document.createElement("article");
        const title = document.createElement("button");
        const actions = document.createElement("div");
        const remove = document.createElement("button");

        item.className = "watch-playlist-item";
        item.classList.toggle("is-current", index === currentIndex);
        item.draggable = true;
        item.dataset.index = String(index);

        title.type = "button";
        title.className = "watch-playlist-title";
        title.textContent = sourceLabel(source, index);
        title.addEventListener("click", () => {
          socket.emit("watch:playlist:select", { index });
        });

        actions.className = "watch-playlist-actions";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          socket.emit("watch:playlist:remove", { index });
        });

        item.addEventListener("dragstart", () => {
          draggedPlaylistIndex = index;
          item.classList.add("is-dragging");
        });
        item.addEventListener("dragend", () => {
          draggedPlaylistIndex = -1;
          item.classList.remove("is-dragging");
        });
        item.addEventListener("dragover", (event) => {
          event.preventDefault();
        });
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          if (draggedPlaylistIndex >= 0 && draggedPlaylistIndex !== index) {
            socket.emit("watch:playlist:reorder", {
              from: draggedPlaylistIndex,
              to: index
            });
          }
        });

        actions.append(remove);
        item.append(title, actions);
        return item;
      })
    );
  }

  function renderChat(messages = []) {
    if (!messages.length) {
      chatList.replaceChildren();
      chatList.textContent = "No room messages yet.";
      return;
    }

    chatList.replaceChildren(
      ...messages.map((message) => {
        const item = document.createElement("article");
        const sender = document.createElement("strong");
        const text = document.createElement("p");

        item.className = "watch-chat-message";
        sender.textContent = participantLabel(message);
        text.textContent = message.text || "";
        item.append(sender, text);
        return item;
      })
    );
    chatList.scrollTop = chatList.scrollHeight;
  }

  function loadYoutubeApi() {
    if (window.YT && window.YT.Player) {
      return Promise.resolve();
    }

    if (youtubeApiPromise) {
      return youtubeApiPromise;
    }

    youtubeApiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    });

    return youtubeApiPromise;
  }

  async function ensureYoutubePlayer(videoId) {
    await loadYoutubeApi();

    youtubeElement.classList.remove("is-hidden");
    instagramFrame.classList.add("is-hidden");
    emptyState.classList.add("is-hidden");

    if (player) {
      return;
    }

    await new Promise((resolve) => {
      player = new window.YT.Player("youtube-player", {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
          widget_referrer: window.location.origin
        },
        events: {
          onReady: () => {
            playerReady = true;
            const iframe = player.getIframe && player.getIframe();
            if (iframe) {
              iframe.referrerPolicy = "strict-origin-when-cross-origin";
              iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
              iframe.allowFullscreen = true;
            }
            resolve();
          },
          onStateChange: handlePlayerStateChange,
          onError: (event) => {
            const code = event && event.data;
            syncStatus.textContent = code === 153
              ? "YouTube needs this page to send its site origin. Refresh once after the update, or open this video on YouTube."
              : "This video cannot be played in an embedded room.";
          }
        }
      });
    });
  }

  function currentPlayerTime() {
    if (!player || !playerReady || typeof player.getCurrentTime !== "function") {
      return 0;
    }

    return Math.max(0, Number(player.getCurrentTime()) || 0);
  }

  function emitControl(action) {
    if (!socket || !socket.connected || !latestState || !latestState.source) {
      return;
    }

    socket.emit("watch:control", {
      action,
      currentTime: currentPlayerTime(),
      isPlaying: action === "play" ? true : action === "pause" ? false : latestState.isPlaying
    }, async (result = {}) => {
      if (result.ok && result.state) {
        await applyState(result.state, action);
        return;
      }

      if (result.error) {
        setStatus(result.error, "error");
      }
    });
  }

  function handlePlayerStateChange(event) {
    if (Date.now() < suppressPlayerEventsUntil || !window.YT || !latestState || !latestState.source) {
      return;
    }

    if (latestState.source.provider !== "youtube") {
      return;
    }

    if (event.data === window.YT.PlayerState.PLAYING) {
      emitControl("play");
      return;
    }

    if (event.data === window.YT.PlayerState.PAUSED) {
      emitControl("pause");
      return;
    }

    if (event.data === window.YT.PlayerState.ENDED) {
      socket.emit("watch:playlist:next", { autoplay: true }, async (result = {}) => {
        if (result.ok && result.state) {
          await applyState(result.state, "next");
        }
      });
    }
  }

  function targetTimeForState(state) {
    const baseTime = Math.max(0, Number(state.currentTime) || 0);
    if (!state.isPlaying || !state.updatedAt) {
      return baseTime;
    }

    return baseTime + Math.max(0, Date.now() - Number(state.updatedAt)) / 1000;
  }

  async function applyYoutubeState(state) {
    await ensureYoutubePlayer(state.source.videoId);

    if (!playerReady) {
      return;
    }

    const targetTime = targetTimeForState(state);
    suppressPlayerEventsUntil = Date.now() + 1500;

    if (lastLoadedVideoId !== state.source.videoId) {
      lastLoadedVideoId = state.source.videoId;
      if (state.isPlaying) {
        player.loadVideoById(state.source.videoId, targetTime);
      } else {
        player.cueVideoById(state.source.videoId, targetTime);
      }
    } else {
      player.seekTo(targetTime, true);
      if (state.isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    }

    lastKnownTime = targetTime;
  }

  function applyInstagramState(state) {
    youtubeElement.classList.add("is-hidden");
    emptyState.classList.add("is-hidden");
    instagramFrame.classList.remove("is-hidden");
    instagramFrame.src = state.source.embedUrl;
    syncStatus.textContent = "Instagram Reel opened. Play/pause sync depends on Instagram.";
  }

  function renderEmpty() {
    youtubeElement.classList.add("is-hidden");
    instagramFrame.classList.add("is-hidden");
    emptyState.classList.remove("is-hidden");
    nowTitle.textContent = "Nothing yet";
    syncStatus.textContent = "Waiting for a video...";
  }

  async function applyState(state, reason = "sync") {
    latestState = state;
    renderViewers(state.viewers || []);
    renderPlaylist();
    renderChat(state.chatMessages || []);

    if (!state.source) {
      renderEmpty();
      return;
    }

    if (state.source.provider === "youtube") {
      nowTitle.textContent = "YouTube watch room";
      syncStatus.textContent = state.isPlaying
        ? `${state.updatedBy || "Someone"} pressed play`
        : reason === "load"
          ? "Video loaded. Press play when you are ready."
          : `${state.updatedBy || "Someone"} paused or synced`;
      await applyYoutubeState(state);
      return;
    }

    if (state.source.provider === "instagram") {
      nowTitle.textContent = "Instagram Reel";
      applyInstagramState(state);
    }
  }

  function joinRoom() {
    if (!socket || !socket.connected) {
      return;
    }

    setStatus("Joining room...", "neutral");
    socket.emit("watch:join", {
      roomId,
      displayName: getDisplayName(),
      username: accountUsername,
      viewerKey
    }, async (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not join room.", "error");
        return;
      }

      setStatus("Room ready.", "success");
      await applyState(result.state || {});
    });
  }

  function connectSocket() {
    if (!window.io) {
      setStatus("Realtime connection is not available.", "error");
      return;
    }

    socket = window.io("/watch", {
      transports: ["websocket", "polling"]
    });

    socket.on("connect", joinRoom);

    socket.on("disconnect", () => {
      setStatus("Disconnected. Reconnecting...", "error");
    });

    socket.on("connect_error", () => {
      setStatus("Please log in to ForyoU first, then reopen Watch Together.", "error");
    });

    socket.on("watch:state", async ({ state, reason }) => {
      await applyState(state, reason);
    });

    socket.on("watch:presence", ({ viewers }) => {
      renderViewers(viewers || []);
    });

    socket.on("watch:chat", ({ message }) => {
      if (!latestState) {
        latestState = {};
      }

      latestState.chatMessages = [...(latestState.chatMessages || []), message].slice(-100);
      renderChat(latestState.chatMessages);
    });

    socket.on("watch:reaction", ({ reaction, displayName }) => {
      const label = reaction === "heart"
        ? "sent a heart"
        : reaction === "miss-you"
          ? "said miss you"
          : "said cute";
      showToast(`${displayName || "Someone"} ${label}`);
    });
  }

  videoForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const urls = videoInput.value.trim();
    if (!urls) {
      setStatus("Paste a video link first.", "error");
      return;
    }

    setStatus("Loading playlist...", "neutral");
    socket.emit("watch:load", { urls }, (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not load this link.", "error");
        return;
      }

      setStatus("Playlist loaded for both of you.", "success");
      videoInput.value = "";
    });
  });

  addWatchVideosButton.addEventListener("click", () => {
    const urls = videoInput.value.trim();
    if (!urls) {
      setStatus("Paste links to add first.", "error");
      return;
    }

    socket.emit("watch:playlist:add", { urls }, (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not add videos.", "error");
        return;
      }

      setStatus("Videos added to the shared queue.", "success");
      videoInput.value = "";
    });
  });

  savePlaylistButton.addEventListener("click", () => {
    const playlist = latestState && Array.isArray(latestState.playlist) ? latestState.playlist : [];
    if (!playlist.length) {
      setStatus("Add videos before saving.", "error");
      return;
    }

    window.localStorage.setItem("foryou_saved_watch_playlist", JSON.stringify(playlist.map((item) => item.originalUrl)));
    setStatus("Playlist saved on this device.", "success");
  });

  loadPlaylistButton.addEventListener("click", () => {
    let saved = [];

    try {
      saved = JSON.parse(window.localStorage.getItem("foryou_saved_watch_playlist") || "[]");
    } catch (error) {
      window.localStorage.removeItem("foryou_saved_watch_playlist");
      setStatus("Saved playlist was damaged. Add videos again.", "error");
      return;
    }

    if (!saved.length) {
      setStatus("No saved playlist on this device.", "error");
      return;
    }

    socket.emit("watch:load", { urls: saved.join("\n") }, (result = {}) => {
      setStatus(result.ok ? "Saved playlist loaded." : result.error || "Could not load playlist.", result.ok ? "success" : "error");
    });
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();

    if (!text) {
      return;
    }

    socket.emit("watch:chat", { text }, (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not send chat.", "error");
      }
    });
    chatInput.value = "";
  });

  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomUrl());
      setStatus("Room link copied.", "success");
    } catch (error) {
      roomLinkInput.select();
      document.execCommand("copy");
      setStatus("Room link copied.", "success");
    }
  });

  nameInput.addEventListener("change", () => {
    window.localStorage.setItem("foryou_watch_name", getDisplayName());
    joinRoom();
  });

  syncNowButton.addEventListener("click", async () => {
    if (latestState && latestState.source) {
      emitControl("sync");
      setStatus("Syncing both screens...", "neutral");
      return;
    }

    if (latestState) {
      await applyState(latestState, "manual-sync");
      setStatus("Synced to the room.", "success");
    }
  });

  document.querySelectorAll("[data-reaction]").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("watch:reaction", {
        reaction: button.dataset.reaction
      });
    });
  });

  window.setInterval(() => {
    if (!playerReady || !latestState || !latestState.source || latestState.source.provider !== "youtube") {
      return;
    }

    if (Date.now() < suppressPlayerEventsUntil) {
      lastKnownTime = currentPlayerTime();
      return;
    }

    const nextTime = currentPlayerTime();
    if (Math.abs(nextTime - lastKnownTime) > 2.4) {
      emitControl("seek");
    }
    lastKnownTime = nextTime;
  }, 1200);

  window.addEventListener("load", () => {
    const params = new URLSearchParams(window.location.search);
    roomId = getRoomId();
    if (!window.location.pathname.startsWith("/watch/")) {
      window.history.replaceState(null, "", `/watch/${encodeURIComponent(roomId)}`);
    }

    viewerKey = getViewerKey();
    accountUsername = cleanUsername(params.get("username") || "");
    nameInput.value = params.get("name") || window.localStorage.getItem("foryou_watch_name") || "Me";
    updateRoomLink();
    renderEmpty();
    renderPlaylist();
    renderChat();
    connectSocket();
  });
})();
