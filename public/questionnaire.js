const form = document.getElementById("questionnaireForm");
const tourTime = document.getElementById("tourTime");
const tourTimeOutput = document.getElementById("tourTimeOutput");

const STORAGE_KEY = "oe_tourism_visitor_profile";
const TIMER_END_STORAGE_KEY = "oe_tourism_timer_end_at";
const TIMER_TEN_MIN_ALERT_PLAYED_STORAGE_KEY = "oe_tourism_timer_ten_min_alert_played";
const TIMER_END_ALERT_PLAYED_STORAGE_KEY = "oe_tourism_timer_end_alert_played";

function updateTourTimeOutput() {
  tourTimeOutput.textContent = `${tourTime.value}分`;
}

function restoreSavedProfile() {
  const savedProfile = localStorage.getItem(STORAGE_KEY);

  if (!savedProfile) return;

  try {
    const profile = JSON.parse(savedProfile);

    setRadioValue("interest", profile.interest);
    setRadioValue("visitExperience", profile.visitExperience);
    setRadioValue("guideStyle", profile.guideStyle);

    if (profile.tourTimeMinutes) {
      tourTime.value = profile.tourTimeMinutes;
      updateTourTimeOutput();
    }
  } catch (error) {
    console.warn("保存済みアンケートの読み込みに失敗しました:", error);
  }
}

function setRadioValue(name, value) {
  if (!value) return;

  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);

  if (input) {
    input.checked = true;
  }
}

tourTime.addEventListener("input", updateTourTimeOutput);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(form);

  const profile = {
    interest: formData.get("interest"),
    visitExperience: formData.get("visitExperience"),
    tourTimeMinutes: Number(formData.get("tourTime")),
    guideStyle: formData.get("guideStyle"),
    answeredAt: new Date().toISOString()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  localStorage.setItem(
    TIMER_END_STORAGE_KEY,
    String(Date.now() + profile.tourTimeMinutes * 60 * 1000)
  );
  localStorage.setItem(TIMER_TEN_MIN_ALERT_PLAYED_STORAGE_KEY, "false");
  localStorage.setItem(TIMER_END_ALERT_PLAYED_STORAGE_KEY, "false");

  window.location.href = "index.html";
});

updateTourTimeOutput();
restoreSavedProfile();
