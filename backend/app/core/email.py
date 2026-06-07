import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


def send_email(to_email: str, subject: str, body: str) -> None:
    smtp_username = settings.SMTP_USERNAME or settings.SMTP_USER
    if not smtp_username or not settings.SMTP_PASSWORD:
        raise RuntimeError("Email sending is not configured")

    message = EmailMessage()
    message["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    context = ssl.create_default_context()
    if settings.SMTP_PORT == 465:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context, timeout=20) as smtp:
            smtp.login(smtp_username, settings.SMTP_PASSWORD)
            smtp.send_message(message)
        return

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls(context=context)
        smtp.ehlo()
        smtp.login(smtp_username, settings.SMTP_PASSWORD)
        smtp.send_message(message)
