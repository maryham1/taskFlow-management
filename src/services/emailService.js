import sgMail from "@sendgrid/mail";

// ======================================================
// EMAIL CONFIGURATION
// ======================================================

const EMAIL_CODE_EXPIRY_MINUTES = 10;

const getEmailConfig = () => {
  const { SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME } =
    process.env;

  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL || !SENDGRID_FROM_NAME) {
    throw new Error(
      "Email configuration is incomplete. Check your SendGrid environment variables.",
    );
  }

  return {
    apiKey: SENDGRID_API_KEY.trim(),
    from: {
      email: SENDGRID_FROM_EMAIL.trim(),
      name: SENDGRID_FROM_NAME.trim(),
    },
  };
};

// ======================================================
// SENDGRID CLIENT
// ======================================================

const getSendGridClient = () => {
  const config = getEmailConfig();

  sgMail.setApiKey(config.apiKey);

  return sgMail;
};

// ======================================================
// EMAIL HELPERS
// ======================================================

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const validateRecipient = (email) => {
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    throw new Error("A valid recipient email is required");
  }
};

const validateCode = (code) => {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw new Error("A valid six-digit code is required");
  }
};

const buildEmailHtml = ({
  greeting,
  heading,
  paragraphs = [],
  code = null,
  footer,
}) => {
  const safeGreeting = escapeHtml(greeting);
  const safeHeading = escapeHtml(heading);

  const paragraphHtml = paragraphs
    .map(
      (paragraph) => `
        <p style="margin: 0 0 16px; color: #475569; line-height: 1.7;">
          ${escapeHtml(paragraph)}
        </p>
      `,
    )
    .join("");

  const codeHtml = code
    ? `
      <div
        style="
          background-color: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 24px;
          margin: 24px 0;
          text-align: center;
        "
      >
        <p
          style="
            margin: 0 0 12px;
            font-size: 13px;
            color: #64748b;
          "
        >
          Your verification code
        </p>

        <div
          style="
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 8px;
            color: #1e293b;
          "
        >
          ${escapeHtml(code)}
        </div>
      </div>
    `
    : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>${safeHeading}</title>
      </head>

      <body
        style="
          margin: 0;
          padding: 32px 16px;
          background-color: #f8fafc;
          font-family: Arial, Helvetica, sans-serif;
        "
      >
        <div
          style="
            max-width: 560px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
          "
        >
          <div
            style="
              padding: 24px 32px;
              background-color: #7c3aed;
              color: #ffffff;
            "
          >
            <h1
              style="
                margin: 0;
                font-size: 24px;
                font-weight: 700;
              "
            >
              TaskFlow
            </h1>
          </div>

          <div style="padding: 32px;">
            <h2
              style="
                margin: 0 0 20px;
                color: #0f172a;
                font-size: 22px;
              "
            >
              ${safeHeading}
            </h2>

            <p
              style="
                margin: 0 0 16px;
                color: #334155;
                line-height: 1.7;
              "
            >
              ${safeGreeting}
            </p>

            ${paragraphHtml}

            ${codeHtml}

            <p
              style="
                margin: 24px 0 0;
                color: #64748b;
                font-size: 13px;
                line-height: 1.6;
              "
            >
              ${escapeHtml(footer)}
            </p>
          </div>

          <div
            style="
              padding: 20px 32px;
              background-color: #f1f5f9;
              text-align: center;
              color: #64748b;
              font-size: 12px;
            "
          >
            TaskFlow — Plan better. Stay focused.
          </div>
        </div>
      </body>
    </html>
  `.trim();
};

// ======================================================
// SEND EMAIL USING SENDGRID API
// ======================================================

const sendEmail = async ({ email, subject, text, html }) => {
  validateRecipient(email);

  const config = getEmailConfig();

  try {
    const client = getSendGridClient();

    const [response] = await client.send({
      from: config.from,
      to: email.trim(),
      subject,
      text,
      html,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `SendGrid rejected the email request with status ${response.statusCode}`,
      );
    }

    const messageId = response.headers?.["x-message-id"] ?? null;

    console.info(`TaskFlow email accepted by SendGrid for ${email.trim()}`, {
      statusCode: response.statusCode,
      messageId,
    });

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error(`TaskFlow email delivery failed for ${email.trim()}:`, {
      message: error.message,
      statusCode: error.code,
      details: error.response?.body?.errors?.map((item) => ({
        message: item.message,
        field: item.field,
      })),
    });

    throw error;
  }
};

// ======================================================
// REGISTRATION / EMAIL VERIFICATION
// ======================================================

export const sendRegistrationEmail = async ({
  email,
  fullName,
  verificationCode,
}) => {
  validateCode(verificationCode);

  const name = fullName?.trim() || "there";

  const subject = "Welcome to TaskFlow - Verify your email";

  const text = `
Hello ${name},

Welcome to TaskFlow!

Your account has been created successfully.

To verify your email address, enter the following code:

${verificationCode}

This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.

If you did not create this account, you can safely ignore this email.

Thank you for choosing TaskFlow.
  `.trim();

  const html = buildEmailHtml({
    greeting: `Hello ${name},`,
    heading: "Verify your email address",

    paragraphs: [
      "Welcome to TaskFlow! Your account has been created successfully.",
      "Enter the six-digit code below to verify your email address.",
      `This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.`,
    ],

    code: verificationCode,

    footer:
      "If you did not create this account, you can safely ignore this email.",
  });

  return sendEmail({
    email,
    subject,
    text,
    html,
  });
};

// ======================================================
// FIRST LOGIN WELCOME EMAIL
// ======================================================

export const sendFirstLoginEmail = async ({ email, fullName }) => {
  const name = fullName?.trim() || "there";

  const subject = "Welcome to TaskFlow";

  const text = `
Hello ${name},

Welcome to TaskFlow!

You have successfully logged into your TaskFlow account for the first time.

You can now create tasks, organize your schedule, set reminders, and track your progress.

We're happy to have you with us.

Happy planning!
  `.trim();

  const html = buildEmailHtml({
    greeting: `Hello ${name},`,
    heading: "Welcome to TaskFlow!",

    paragraphs: [
      "You've successfully logged into your TaskFlow account.",
      "You can now create tasks, organize your schedule, set reminders, and track your progress.",
      "We're happy to have you with us. Happy planning!",
    ],

    footer: "This is a welcome message from TaskFlow.",
  });

  return sendEmail({
    email,
    subject,
    text,
    html,
  });
};

// ======================================================
// PASSWORD RESET EMAIL
// ======================================================

export const sendPasswordResetEmail = async ({
  email,
  fullName,
  resetCode,
}) => {
  validateCode(resetCode);

  const name = fullName?.trim() || "there";

  const subject = "Reset your TaskFlow password";

  const text = `
Hello ${name},

We received a request to reset your TaskFlow password.

Use the following verification code to continue:

${resetCode}

This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can safely ignore this email.

For your security, do not share this code with anyone.
  `.trim();

  const html = buildEmailHtml({
    greeting: `Hello ${name},`,
    heading: "Reset your password",

    paragraphs: [
      "We received a request to reset your TaskFlow password.",
      "Use the six-digit code below to continue.",
      `This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.`,
      "For your security, do not share this code with anyone.",
    ],

    code: resetCode,

    footer:
      "If you did not request a password reset, you can safely ignore this email.",
  });

  return sendEmail({
    email,
    subject,
    text,
    html,
  });
};

// ======================================================
// PASSWORD CHANGED CONFIRMATION
// ======================================================

export const sendPasswordChangedEmail = async ({ email, fullName }) => {
  const name = fullName?.trim() || "there";

  const subject = "Your TaskFlow password was changed";

  const text = `
Hello ${name},

Your TaskFlow password has been changed successfully.

If you made this change, no further action is required.

If you did not change your password, please secure your account immediately.
  `.trim();

  const html = buildEmailHtml({
    greeting: `Hello ${name},`,
    heading: "Password changed successfully",

    paragraphs: [
      "Your TaskFlow password has been changed successfully.",
      "If you made this change, no further action is required.",
      "If you did not make this change, please secure your account immediately.",
    ],

    footer: "This is an automated security notification from TaskFlow.",
  });

  return sendEmail({
    email,
    subject,
    text,
    html,
  });
};

// ======================================================
// EMAIL CHANGE VERIFICATION
// ======================================================

export const sendEmailChangeVerificationEmail = async ({
  email,
  fullName,
  verificationCode,
}) => {
  validateRecipient(email);
  validateCode(verificationCode);

  const name = fullName?.trim() || "there";

  const subject = "Verify your new TaskFlow email address";

  const text = `
Hello ${name},

We received a request to change the email address associated with your TaskFlow account.

To confirm that this new email address belongs to you, enter the following verification code:

${verificationCode}

This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.

Your current email address will remain unchanged until you successfully verify this code.

If you did not request this email change, please ignore this message and secure your TaskFlow account.

For your security, never share this verification code with anyone.

Thank you for using TaskFlow.
  `.trim();

  const html = buildEmailHtml({
    greeting: `Hello ${name},`,
    heading: "Verify your new email address",

    paragraphs: [
      "We received a request to change the email address associated with your TaskFlow account.",
      "Enter the six-digit verification code below to confirm your new email address.",
      `This code expires in ${EMAIL_CODE_EXPIRY_MINUTES} minutes.`,
      "Your current email address will remain unchanged until verification is successful.",
      "For your security, never share this code with anyone.",
    ],

    code: verificationCode,

    footer:
      "If you did not request this email change, please ignore this message and secure your TaskFlow account.",
  });

  return sendEmail({
    email,
    subject,
    text,
    html,
  });
};
