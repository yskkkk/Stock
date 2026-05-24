/**
 * 회원가입·알림용 트랜잭션 메일 (SMTP)
 *
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * SMTP_FROM_NAME — 수신함에 보이는 이름만 (기본 YSTOCK, 주소 숨김)
 * SMTP_FROM_ADDRESS — (선택) 발신 주소, 비우면 SMTP_USER
 * SMTP_FROM — (레거시) "이름" 또는 "이름 <addr@>" 형식
 * 로컬 테스트: EMAIL_VERIFY_MOCK=1 → 콘솔만 출력
 */
import nodemailer from "nodemailer";

/** @type {import("nodemailer").Transporter | null} */
let transporter = null;

export function isEmailSendingConfigured() {
  if (process.env.EMAIL_VERIFY_MOCK === "1") return true;
  return Boolean(String(process.env.SMTP_HOST ?? "").trim());
}

function getTransporter() {
  if (process.env.EMAIL_VERIFY_MOCK === "1") return null;
  const host = String(process.env.SMTP_HOST ?? "").trim();
  if (!host) {
    throw new Error(
      "이메일 발송이 설정되지 않았습니다. 서버에 SMTP_HOST 등을 설정하세요.",
    );
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure =
      process.env.SMTP_SECURE === "1" || port === 465;
    const user = String(process.env.SMTP_USER ?? "").trim();
    const pass = String(process.env.SMTP_PASS ?? "");
    transporter = nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      auth: user ? { user, pass } : undefined,
    });
  }
  return transporter;
}

/**
 * 수신함에는 이름만 보이게 — 주소는 SMTP 인증용으로만 사용
 * @returns {{ name: string; address: string }}
 */
export function resolveMailFrom() {
  const nameEnv = String(process.env.SMTP_FROM_NAME ?? "").trim();
  const rawFrom = String(process.env.SMTP_FROM ?? "").trim();
  const addrEnv = String(process.env.SMTP_FROM_ADDRESS ?? "").trim();
  const user = String(process.env.SMTP_USER ?? "").trim();

  let displayName = nameEnv || "YSTOCK";
  let address = addrEnv || user || "noreply@ystock.local";

  if (rawFrom) {
    const angled = rawFrom.match(/^([^<]+?)\s*<([^>]+)>$/);
    if (angled) {
      displayName = angled[1].trim().replace(/^["']|["']$/g, "") || displayName;
      address = angled[2].trim();
    } else if (rawFrom.includes("@")) {
      address = rawFrom;
    } else {
      displayName = rawFrom;
    }
  }

  if (displayName.includes("@")) {
    displayName = "YSTOCK";
  }

  return { name: displayName, address };
}

/**
 * @param {{ to: string; subject: string; text: string; html?: string }} msg
 */
export async function sendTransactionalEmail(msg) {
  const to = String(msg.to ?? "").trim();
  if (!to) throw new Error("수신 이메일이 비어 있습니다.");

  if (process.env.EMAIL_VERIFY_MOCK === "1") {
    console.info("[email:mock]", {
      to,
      subject: msg.subject,
      text: msg.text,
    });
    return { mock: true };
  }

  const transport = getTransporter();
  const from = resolveMailFrom();
  const replyTo = String(process.env.SMTP_REPLY_TO ?? "").trim();

  await transport.sendMail({
    from: {
      name: from.name,
      address: from.address,
    },
    ...(replyTo ? { replyTo } : {}),
    to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html ?? undefined,
  });
  return { mock: false };
}
