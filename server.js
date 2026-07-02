import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = 3000;

// publicフォルダを公開。最初にアンケートページを表示する。
app.use(express.static("public", { index: "questionnaire.html" }));

// ブラウザから送られてくるSDPを文字列として受け取る
app.use(express.text({ type: ["application/sdp", "text/plain"] }));

// oe_info フォルダ内の .txt ファイルをすべて読み込む関数
function loadTextFilesFromFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    console.warn(`参照フォルダが見つかりません: ${folderPath}`);
    return "";
  }

  const files = fs
    .readdirSync(folderPath)
    .filter((file) => file.endsWith(".txt"));

  if (files.length === 0) {
    console.warn(`参照フォルダ内に .txt ファイルがありません: ${folderPath}`);
    return "";
  }

  const contents = files.map((file) => {
    const filePath = path.join(folderPath, file);
    const text = fs.readFileSync(filePath, "utf-8");

    return `
【${file}】
${text}
`;
  });

  return contents.join("\n\n");
}

// 参照情報フォルダ
const oeInfo = loadTextFilesFromFolder("./oe_info");

const sessionConfig = JSON.stringify({
  type: "realtime",
  model: "gpt-realtime-2",
  instructions: `
あなたは大江地域の観光案内AIです。
短く、親しみやすく返答してください。
相手が話しかけたら、音声で返事をしてください。

以下は、大江についての参考情報です。
質問に答えるときは、できるだけこの情報を優先して答えてください。
参考情報に書かれていないことは、一般的な情報を参照して説明してください。

【大江についての参考情報】
${oeInfo}
`,
  audio: {
    output: {
      voice: "marin"
    }
  }
});

app.post("/session", async (req, res) => {
  try {
    const formData = new FormData();

    formData.set("sdp", req.body);
    formData.set("session", sessionConfig);

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(errorText);
      return res.status(500).send(errorText);
    }

    const answerSdp = await response.text();
    res.type("application/sdp").send(answerSdp);

  } catch (error) {
    console.error(error);
    res.status(500).send("Realtime API接続に失敗しました");
  }
});

app.listen(PORT, () => {
  console.log(`起動しました: http://localhost:${PORT}`);
});
