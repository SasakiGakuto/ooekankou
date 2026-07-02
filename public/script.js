const pageTitle = document.getElementById("pageTitle");
const characterTitle = document.getElementById("characterTitle");

const thumbnail = document.getElementById("thumbnail");
const video = document.getElementById("video");
const startVoice = document.getElementById("startVoice");

const statusText = document.getElementById("status");
const callButton = document.getElementById("callButton");
const visitorProfileSummary = document.getElementById("visitorProfileSummary");
const tourTimerText = document.getElementById("tourTimerText");
const stopAlertAudio = document.getElementById("stopAlertAudio");
const stopCallAudio = document.getElementById("stopCallAudio");

const characterSwitchButton = document.getElementById("characterSwitchButton");
const characterSwitchIcon = document.getElementById("characterSwitchIcon");

const characters = {
  kurooni: {
    id: "kurooni",
    name: "くろおにくん",
    pageTitle: "大江観光案内AI　くろおにくん",
    callTitle: "くろおにくんを呼び出す",
    thumbnail: "kurooni/seisi.jpg",
    video: "kurooni/kutipaku.mp4",
    openingVoice: "kurooni/start_voice.mp3",
    secondOpeningVoice: "kurooni/second_voice.mp3",
    switchIcon: "kurooni/switch_icon.png",
    switchTo: "iwato"
  },
  iwato: {
    id: "iwato",
    name: "いわとちゃん",
    pageTitle: "大江観光案内AI　いわとちゃん",
    callTitle: "いわとちゃんを呼び出す",
    thumbnail: "iwato/seisi.jpg",
    video: "iwato/kutipaku.mp4",
    openingVoice: "iwato/start_voice.mp3",
    secondOpeningVoice: "iwato/second_voice.mp3",
    switchIcon: "iwato/switch_icon.png",
    switchTo: "kurooni"
  }
};

let currentCharacterId = "kurooni";
const characterCallCounts = {
  kurooni: 0,
  iwato: 0
};

const VISITOR_PROFILE_STORAGE_KEY = "oe_tourism_visitor_profile";
const TOUR_TIMER_END_STORAGE_KEY = "oe_tourism_timer_end_at";
const TOUR_TIMER_TEN_MIN_ALERT_PLAYED_STORAGE_KEY = "oe_tourism_timer_ten_min_alert_played";
const TOUR_TIMER_END_ALERT_PLAYED_STORAGE_KEY = "oe_tourism_timer_end_alert_played";
let visitorProfile = loadVisitorProfile();

let pc = null;
let dataChannel = null;
let localStream = null;
let localAudioTrack = null;
let remoteAudio = null;

let audioContext = null;
let sourceNode = null;
let analyserNode = null;
let silentGainNode = null;
let monitorInterval = null;

let isConnected = false;
let isConnecting = false;
let isRecording = false;
let isAiSpeaking = false;
let isWaitingAiResponse = false;
let isAfterAiVideoPlaying = false;
let hasRequestedResponse = false;

let latestMicVolume = 0;
let lastRealtimeEventType = "なし";
let lastRealtimeError = "なし";

let responseStartTimeoutTimer = null;
let afterAiVideoTimer = null;
let tourTimerInterval = null;
let recordingStartedAt = 0;

const MIN_RECORDING_MS = 1000;
const RESPONSE_START_TIMEOUT_MS = 12000;
const AFTER_AI_VIDEO_PLAY_MS = 10000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

applyCharacterToScreen();
renderVisitorProfileSummary();
startTourTimer();
setCallButton("呼び出し", false);
updateDevStatus("待機", "呼び出し待ち");

callButton.addEventListener("click", async () => {
  if (isConnecting || isAiSpeaking || isWaitingAiResponse || isAfterAiVideoPlaying) {
    return;
  }

  const buttonText = callButton.textContent;

  try {
    if (buttonText === "呼び出し") {
      await firstCall();
      return;
    }

    if (buttonText === "録音開始") {
      await startRecording();
      return;
    }

    if (buttonText === "録音終了") {
      requestAiResponse("manual_recording_end");
      return;
    }
  } catch (error) {
    console.error(error);

    updateDevStatus(
      "Error",
      `処理中にエラーが発生しました: ${error.message}`
    );

    stopRecording();
    stopVideo();

    setCallButton("録音開始", false);
    characterSwitchButton.disabled = false;
  }
});

characterSwitchButton.addEventListener("click", () => {
  if (isConnecting || isRecording || isAiSpeaking || isWaitingAiResponse || isAfterAiVideoPlaying) {
    return;
  }

  const current = characters[currentCharacterId];
  const nextCharacterId = current.switchTo;
  const next = characters[nextCharacterId];

  stopRealtime();
  stopVideo();

  startVoice.pause();
  startVoice.currentTime = 0;

  currentCharacterId = nextCharacterId;

  applyCharacterToScreen();
  setCallButton("呼び出し", false);

  updateDevStatus(
    "CharacterChanged",
    `${next.name} に切り替えました。呼び出し待ちです。`
  );
});

async function firstCall() {
  const character = characters[currentCharacterId];
  const openingVoiceKind =
    characterCallCounts[currentCharacterId] === 0
      ? "スタート音声"
      : "2回目以降の呼び出し音声";

  setCallButton("呼び出し", true);
  characterSwitchButton.disabled = true;

  updateDevStatus(
    "Opening",
    `${character.name} の${openingVoiceKind}を再生中です。`
  );

  setOpeningVoiceForCurrentCharacter();
  startVideo();
  await playOpeningVoice();
  characterCallCounts[currentCharacterId] += 1;
  stopVideo();

  updateDevStatus(
    "Connect",
    `${character.name} のRealtime APIへ接続中です。`
  );

  await startRealtime();
  isConnected = true;

  setCallButton("録音開始", false);
  characterSwitchButton.disabled = false;

  updateDevStatus(
    "Ready",
    "スタート音声が終了しました。録音開始ボタンを押すと録音します。"
  );
}

async function startRecording() {
  if (!isConnected) {
    await startRealtime();
    isConnected = true;
  }

  if (!dataChannel || dataChannel.readyState !== "open") {
    updateDevStatus(
      "Recording Error",
      `DataChannelがopenではありません。現在: ${dataChannel ? dataChannel.readyState : "未作成"}`
    );
    return;
  }

  dataChannel.send(JSON.stringify({
    type: "input_audio_buffer.clear"
  }));

  isRecording = true;
  isAiSpeaking = false;
  isWaitingAiResponse = false;
  hasRequestedResponse = false;
  lastRealtimeError = "なし";
  recordingStartedAt = Date.now();

  if (audioContext && audioContext.state === "suspended") {
    await audioContext.resume();
  }

  updateAudioTrackState();
  stopVideo();

  setCallButton("録音終了", false);
  characterSwitchButton.disabled = true;

  updateDevStatus(
    "Recording",
    "録音中です。録音終了ボタンを押すと音声を確定してAIへ送信します。"
  );
}

function stopRecording() {
  isRecording = false;
  updateAudioTrackState();
}

function requestAiResponse(reason) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    updateDevStatus(
      "Response Error",
      `DataChannelが使用できません。現在: ${dataChannel ? dataChannel.readyState : "未作成"}`
    );

    stopRecording();
    setCallButton("録音開始", false);
    characterSwitchButton.disabled = false;
    return;
  }

  if (hasRequestedResponse) {
    return;
  }

  const recordingTime = Date.now() - recordingStartedAt;

  if (recordingTime < MIN_RECORDING_MS) {
    updateDevStatus(
      "Recording Too Short",
      "録音時間が短すぎます。1秒以上話してから録音終了を押してください。"
    );
    return;
  }

  hasRequestedResponse = true;
  isWaitingAiResponse = true;

  setCallButton("案内中", true);
  characterSwitchButton.disabled = true;

  // stopRecording() はまだ呼ばない。
  // マイクONのまま input_audio_buffer.commit する。
  updateAudioTrackState();
  startVideo();

  const character = characters[currentCharacterId];

  try {
    dataChannel.send(JSON.stringify({
      type: "input_audio_buffer.commit"
    }));

    updateDevStatus(
      "Input Commit",
      `録音音声をcommitしました。理由: ${reason}。`
    );

    setResponseStartTimeout();

    setTimeout(() => {
      if (!dataChannel || dataChannel.readyState !== "open") {
        updateDevStatus(
          "Response Error",
          "response.create送信前にDataChannelが閉じました。"
        );

        isWaitingAiResponse = false;
        hasRequestedResponse = false;

        stopRecording();
        stopVideo();
        setCallButton("録音開始", false);
        characterSwitchButton.disabled = false;
        return;
      }

      dataChannel.send(JSON.stringify({
        type: "response.create",
        response: {
          instructions: `${buildVisitorProfileInstruction()}

${character.name}として、直前のユーザーの録音内容に対して音声で返答してください。
録音内容と関係ない話はしないでください。
利用者の興味・来訪経験・案内の好みに合わせて、大江の観光案内として自然に答えてください。`
        }
      }));

      updateDevStatus(
        "Response Create",
        "response.createを送信しました。AI回答待ちです。"
      );

      setTimeout(() => {
        stopRecording();
      }, 500);
    }, 300);
  } catch (error) {
    updateDevStatus(
      "Response Error",
      `commit または response.create の送信に失敗: ${error.message}`
    );

    isWaitingAiResponse = false;
    hasRequestedResponse = false;

    stopRecording();
    stopVideo();
    setCallButton("録音開始", false);
    characterSwitchButton.disabled = false;
  }
}

function onAiSpeechStart(eventType) {
  const character = characters[currentCharacterId];

  if (responseStartTimeoutTimer) {
    clearTimeout(responseStartTimeoutTimer);
    responseStartTimeoutTimer = null;
  }

  isAiSpeaking = true;
  isWaitingAiResponse = false;

  stopRecording();
  startVideo();

  setCallButton("案内中", true);
  characterSwitchButton.disabled = true;

  updateDevStatus(
    "AI Speaking",
    `${character.name} のAI回答開始イベントを検出しました: ${eventType}`
  );
}

function onAiSpeechEnd(eventType) {
  if (isAfterAiVideoPlaying) {
    return;
  }

  if (!hasRequestedResponse && !isWaitingAiResponse && !isAiSpeaking) {
    return;
  }

  isAiSpeaking = false;
  isWaitingAiResponse = false;
  hasRequestedResponse = false;
  isAfterAiVideoPlaying = true;

  stopRecording();
  startVideo();

  setCallButton("案内中", true);
  characterSwitchButton.disabled = true;

  updateDevStatus(
    "AI Video Continue",
    `AI回答終了イベントを検出しました: ${eventType}。10秒間動画を再生し続けます。`
  );

  if (afterAiVideoTimer) {
    clearTimeout(afterAiVideoTimer);
  }

  afterAiVideoTimer = setTimeout(() => {
    isAfterAiVideoPlaying = false;
    afterAiVideoTimer = null;

    stopVideo();

    setCallButton("録音開始", false);
    characterSwitchButton.disabled = false;

    updateDevStatus(
      "Ready",
      "AI回答後の動画再生が終了しました。再び録音開始できます。"
    );
  }, AFTER_AI_VIDEO_PLAY_MS);
}

function setResponseStartTimeout() {
  if (responseStartTimeoutTimer) {
    clearTimeout(responseStartTimeoutTimer);
  }

  responseStartTimeoutTimer = setTimeout(() => {
    if (isWaitingAiResponse && !isAiSpeaking) {
      isWaitingAiResponse = false;
      hasRequestedResponse = false;

      stopRecording();
      stopVideo();

      setCallButton("録音開始", false);
      characterSwitchButton.disabled = false;

      updateDevStatus(
        "Response Timeout",
        "AI回答開始イベントが来なかったため、録音開始状態に戻しました。"
      );
    }
  }, RESPONSE_START_TIMEOUT_MS);
}

function setCallButton(text, disabled) {
  callButton.textContent = text;
  callButton.disabled = disabled;
}

function updateAudioTrackState() {
  if (!localAudioTrack) return;

  localAudioTrack.enabled = isRecording && !isAiSpeaking;
}

async function startRealtime() {
  if (isConnecting) return;
  if (pc) return;

  isConnecting = true;

  try {
    const character = characters[currentCharacterId];

    pc = new RTCPeerConnection();

    remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    document.body.appendChild(remoteAudio);

    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];

      updateDevStatus(
        "RemoteAudio",
        `${character.name} のAI音声トラックを受信しました。`
      );
    };

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true
      }
    });

    localAudioTrack = localStream.getAudioTracks()[0];

    if (!localAudioTrack) {
      throw new Error("マイクの音声トラックが取得できませんでした。");
    }

    localAudioTrack.enabled = false;

    pc.addTrack(localAudioTrack, localStream);
    setupMicMonitor(localStream);

    dataChannel = pc.createDataChannel("oai-events");
    dataChannel.addEventListener("open", () => {
      dataChannel.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              turn_detection: null
            }
          }
        }
      }));

       updateDevStatus(
        "DataChannel",
        `${character.name} のDataChannelがopenになりました。手動録音モードに設定しました。`
      );
    });

    dataChannel.addEventListener("message", handleRealtimeEvent);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(`/session?character=${character.id}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        "Content-Type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    const answerSdp = await sdpResponse.text();

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp
    });

    updateDevStatus(
      "Connected",
      `${character.name} のAI接続が完了しました。`
    );
  } finally {
    isConnecting = false;
  }
}

function handleRealtimeEvent(event) {
  let data;

  try {
    data = JSON.parse(event.data);
  } catch (error) {
    console.warn("Realtime event parse error:", error);
    return;
  }

  console.log("OpenAI event:", data);

  const type = data.type;
  lastRealtimeEventType = type;

  const aiStartEvents = [
    "response.created",
    "response.audio.delta",
    "response.output_audio.delta",
    "output_audio_buffer.started"
  ];

  const aiEndEvents = [
    "response.audio.done",
    "response.output_audio.done",
    "response.done",
    "output_audio_buffer.stopped"
  ];

  if (type === "session.updated") {
    updateDevStatus(
      "Session Updated",
      "手動録音モードの設定が反映されました。"
    );
  }

  if (type === "input_audio_buffer.cleared") {
    updateDevStatus(
      "Input Cleared",
      "前回の入力音声バッファをクリアしました。"
    );
  }

  if (type === "input_audio_buffer.speech_started") {
    updateDevStatus(
      "User Speech",
      "Realtime APIがユーザーの発話開始を検出しました。"
    );
  }

  if (type === "input_audio_buffer.speech_stopped") {
    updateDevStatus(
      "User Speech End",
      "Realtime APIがユーザーの発話終了を検出しました。"
    );
  }

  if (type === "input_audio_buffer.committed") {
    updateDevStatus(
      "Input Committed",
      "録音音声が会話に確定されました。response.create待ちです。"
    );
  }

  if (aiStartEvents.includes(type)) {
    onAiSpeechStart(type);
  }

  if (aiEndEvents.includes(type)) {
    onAiSpeechEnd(type);
  }

  if (type === "error") {
    lastRealtimeError = JSON.stringify(data, null, 2);

    updateDevStatus(
      "Realtime Error",
      lastRealtimeError
    );

    isWaitingAiResponse = false;
    isAiSpeaking = false;
    hasRequestedResponse = false;

    stopRecording();
    stopVideo();

    setCallButton("録音開始", false);
    characterSwitchButton.disabled = false;
  }
}

function setupMicMonitor(stream) {
  audioContext = new AudioContext();

  sourceNode = audioContext.createMediaStreamSource(stream);
  analyserNode = audioContext.createAnalyser();
  silentGainNode = audioContext.createGain();

  analyserNode.fftSize = 2048;
  silentGainNode.gain.value = 0;

  sourceNode.connect(analyserNode);
  analyserNode.connect(silentGainNode);
  silentGainNode.connect(audioContext.destination);

  startMicMonitor();
}

function startMicMonitor() {
  if (!analyserNode) return;

  const dataArray = new Uint8Array(analyserNode.fftSize);

  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  monitorInterval = setInterval(() => {
    analyserNode.getByteTimeDomainData(dataArray);

    let max = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const value = Math.abs(dataArray[i] - 128) / 128;

      if (value > max) {
        max = value;
      }
    }

    latestMicVolume = max;

    if (isRecording && !isAiSpeaking) {
      updateDevStatus(
        "Recording",
        "録音中です。録音終了ボタンを押すとAIへ送信します。"
      );
    }
  }, 500);
}

function playOpeningVoice() {
  return new Promise((resolve, reject) => {
    startVoice.currentTime = 0;

    startVoice.onended = () => resolve();

    startVoice.onerror = () => {
      reject(new Error("スタート音声の再生に失敗しました。"));
    };

    const playPromise = startVoice.play();

    if (playPromise) {
      playPromise.catch(reject);
    }
  });
}

function startVideo() {
  thumbnail.style.display = "none";
  video.style.display = "block";

  video.play().catch((error) => {
    console.warn("動画再生に失敗しました:", error);
  });
}

function stopVideo() {
  video.pause();
  video.currentTime = 0;
  video.style.display = "none";
  thumbnail.style.display = "block";
}

function applyCharacterToScreen() {
  const character = characters[currentCharacterId];
  const nextCharacter = characters[character.switchTo];

  pageTitle.textContent = character.pageTitle;
  characterTitle.textContent = character.callTitle;

  thumbnail.src = character.thumbnail;
  thumbnail.alt = `${character.name}画像`;

  video.pause();
  video.currentTime = 0;
  video.src = character.video;
  video.load();

  startVoice.pause();
  startVoice.currentTime = 0;
  setOpeningVoiceForCurrentCharacter();

  characterSwitchIcon.src = nextCharacter.switchIcon;
  characterSwitchIcon.alt = `${nextCharacter.name}に切り替え`;

  stopVideo();
}

function setOpeningVoiceForCurrentCharacter() {
  const character = characters[currentCharacterId];
  const callCount = characterCallCounts[currentCharacterId] || 0;

  startVoice.src =
    callCount === 0
      ? character.openingVoice
      : character.secondOpeningVoice;

  startVoice.load();
}

function loadVisitorProfile() {
  const savedProfile = localStorage.getItem(VISITOR_PROFILE_STORAGE_KEY);

  if (!savedProfile) return null;

  try {
    return JSON.parse(savedProfile);
  } catch (error) {
    console.warn("アンケート回答の読み込みに失敗しました:", error);
    return null;
  }
}

function renderVisitorProfileSummary() {
  if (!visitorProfileSummary) return;

  if (!visitorProfile) {
    visitorProfileSummary.textContent =
      "未設定です。変更ボタンからアンケートに回答できます。";
    return;
  }

  visitorProfileSummary.textContent =
    `興味: ${visitorProfile.interest} / ` +
    `来訪経験: ${visitorProfile.visitExperience} / ` +
    `案内: ${visitorProfile.guideStyle}`;
}

function startTourTimer() {
  if (!tourTimerText) return;

  let timerEndAt = Number(localStorage.getItem(TOUR_TIMER_END_STORAGE_KEY));

  if (!timerEndAt && visitorProfile && visitorProfile.tourTimeMinutes) {
    timerEndAt = Date.now() + visitorProfile.tourTimeMinutes * 60 * 1000;
    localStorage.setItem(TOUR_TIMER_END_STORAGE_KEY, String(timerEndAt));
    localStorage.setItem(TOUR_TIMER_TEN_MIN_ALERT_PLAYED_STORAGE_KEY, "false");
    localStorage.setItem(TOUR_TIMER_END_ALERT_PLAYED_STORAGE_KEY, "false");
  }

  if (!timerEndAt) {
    tourTimerText.textContent = "--:--";
    return;
  }

  updateTourTimer(timerEndAt);

  if (tourTimerInterval) {
    clearInterval(tourTimerInterval);
  }

  tourTimerInterval = setInterval(() => {
    updateTourTimer(timerEndAt);
  }, 1000);
}

function updateTourTimer(timerEndAt) {
  const remainingMs = Math.max(0, timerEndAt - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  tourTimerText.textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  if (remainingMs > 0) {
    tourTimerText.classList.remove("timer-expired");

    if (shouldPlayTenMinuteAlert(remainingMs)) {
      playTimerAudioOnce(
        stopAlertAudio,
        TOUR_TIMER_TEN_MIN_ALERT_PLAYED_STORAGE_KEY,
        "10分前通知音声"
      );
    }

    return;
  }

  tourTimerText.classList.add("timer-expired");

  if (tourTimerInterval) {
    clearInterval(tourTimerInterval);
    tourTimerInterval = null;
  }

  playTimerAudioOnce(
    stopCallAudio,
    TOUR_TIMER_END_ALERT_PLAYED_STORAGE_KEY,
    "案内終了音声"
  );
}

function shouldPlayTenMinuteAlert(remainingMs) {
  const tourTimeMinutes = visitorProfile
    ? Number(visitorProfile.tourTimeMinutes)
    : 0;

  return tourTimeMinutes > 10 && remainingMs <= TEN_MINUTES_MS;
}

function playTimerAudioOnce(audioElement, storageKey, label) {
  const alreadyPlayed =
    localStorage.getItem(storageKey) === "true";

  if (alreadyPlayed || !audioElement) return;

  localStorage.setItem(storageKey, "true");

  audioElement.currentTime = 0;
  audioElement.play().catch((error) => {
    console.warn(`${label}の再生に失敗しました:`, error);
  });
}

function buildVisitorProfileInstruction() {
  if (!visitorProfile) {
    return `
利用者の状況:
アンケート回答は未設定です。
初めて大江に来た観光客にも分かるように、短く親しみやすく案内してください。`;
  }

return `
利用者の状況:
興味のある分野: ${visitorProfile.interest}
大江への来訪経験: ${visitorProfile.visitExperience}
好みの案内: ${visitorProfile.guideStyle}

案内方針:
- 興味のある分野を優先して説明する。
- 来訪経験に合わせて、初めてなら基本から、何度か来た人には少し詳しく説明する。
- 好みの案内に合わせて、短さ、歴史の詳しさ、面白さのどれを重視するか調整する。`;
}

function stopRealtime() {
  stopRecording();

  if (responseStartTimeoutTimer) {
    clearTimeout(responseStartTimeoutTimer);
    responseStartTimeoutTimer = null;
  }

  if (afterAiVideoTimer) {
    clearTimeout(afterAiVideoTimer);
    afterAiVideoTimer = null;
  }

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  localAudioTrack = null;

  if (pc) {
    pc.close();
    pc = null;
  }

  if (remoteAudio) {
    remoteAudio.remove();
    remoteAudio = null;
  }

  if (silentGainNode) {
    silentGainNode.disconnect();
    silentGainNode = null;
  }

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  dataChannel = null;

  isConnected = false;
  isConnecting = false;
  isRecording = false;
  isAiSpeaking = false;
  isWaitingAiResponse = false;
  isAfterAiVideoPlaying = false;
  hasRequestedResponse = false;

  latestMicVolume = 0;
  lastRealtimeEventType = "なし";
  lastRealtimeError = "なし";
  recordingStartedAt = 0;
}

function updateDevStatus(state, detail) {
  if (!statusText) return;

  const character = characters[currentCharacterId];

  const connectionState = isConnected ? "接続ON" : "接続OFF";
  const recordingState = isRecording ? "録音ON" : "録音OFF";

  const aiState = isAiSpeaking
    ? "AI回答中"
    : isWaitingAiResponse
      ? "AI回答待ち"
      : "AI待機中";

  const videoState =
    video && video.style.display === "block" && !video.paused
      ? "動画ON"
      : "動画OFF";

  const buttonState = callButton
    ? `${callButton.textContent} / disabled=${callButton.disabled}`
    : "不明";

  statusText.textContent =
`[${state}]
処理内容: ${detail}
現在キャラクター: ${character.name}
AI接続: ${connectionState}
録音状態: ${recordingState}
AI状態: ${aiState}
動画状態: ${videoState}
ボタン表示: ${buttonState}`;
}
