import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

SMTP_EMAIL    = os.getenv('SMTP_EMAIL')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD')
CONTACT_EMAIL = os.getenv('CONTACT_EMAIL')


@app.route('/api/contact', methods=['POST'])
def contact():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    name    = (data.get('name')    or '').strip()
    email   = (data.get('email')   or '').strip()
    message = (data.get('message') or '').strip()

    if not name or not email or not message:
        return jsonify({'error': 'Missing fields'}), 400

    msg = MIMEMultipart()
    msg['From']     = SMTP_EMAIL
    msg['To']       = CONTACT_EMAIL
    msg['Subject']  = f'Website Contact: {name}'
    msg['Reply-To'] = email
    msg.attach(MIMEText(f'From: {name} <{email}>\n\n{message}', 'plain'))

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)
        return jsonify({'ok': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8001)
