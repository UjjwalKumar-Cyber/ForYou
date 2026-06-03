(() => {
  const roomLinkInput = document.querySelector("#watch-room-link");
  const copyLinkButton = document.querySelector("#copy-watch-link");
  const nameInput = document.querySelector("#watch-name");
  const statusText = document.querySelector("#watch-status");
  const videoForm = document.querySelector("#watch-video-form");
  const videoInput = document.querySelector("#watch-url");
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
        item.textContent = viewer.displayName || "Someone";
        return item;
      })
    );
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
          playsinline: 1,
          rel: 0,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            playerReady = true;
            resolve();
          },
          onStateChange: handlePlayerStateChange,
          onError: () => {
            syncStatus.textContent = "This video cannot be played in an embedded room.";
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
      emitControl("pause");
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
      displayName: getDisplayName()
    }, async (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not join room.", "error");
        return;
      }

      setStatus("Room ready. Share the link with her.", "success");
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
      setStatus("Could not connect. Refresh once.", "error");
    });

    socket.on("watch:state", async ({ state, reason }) => {
      await applyState(state, reason);
    });

    socket.on("watch:presence", ({ viewers }) => {
      renderViewers(viewers || []);
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

    const url = videoInput.value.trim();
    if (!url) {
      setStatus("Paste a video link first.", "error");
      return;
    }

    setStatus("Loading video...", "neutral");
    socket.emit("watch:load", { url }, (result = {}) => {
      if (!result.ok) {
        setStatus(result.error || "Could not load this link.", "error");
        return;
      }

      setStatus("Video loaded for both of you.", "success");
      videoInput.value = "";
    });
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
    roomId = getRoomId();
    if (!window.location.pathname.startsWith("/watch/")) {
      window.history.replaceState(null, "", `/watch/${encodeURIComponent(roomId)}`);
    }

    nameInput.value = window.localStorage.getItem("foryou_watch_name") || "Me";
    updateRoomLink();
    renderEmpty();
    connectSocket();
  });
})();
