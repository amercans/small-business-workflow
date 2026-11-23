import type { LegalPack } from './types'

export const enLegal: LegalPack = {
  policy: {
    title: '{{APP_NAME}} Workplace Policy',
    intro: 'This policy explains how employees of {{COMPANY_NAME}} (the "Company") use {{APP_NAME}} for leave, expenses, advances, purchases, travel and company equipment.',
    sections: [
      {
        h: '1. Scope',
        p: [
          'Requests for leave, expenses, advances, purchases and travel, and the assignment of company equipment and software accounts, are handled in the panel.',
          'If you cannot reach the panel (for example due to illness, a technical problem or an emergency), tell your manager by email or phone and the request will be recorded in the panel as soon as possible. This does not limit any notice rights you have under law.',
        ],
      },
      {
        h: '2. Your account',
        p: [
          'Sign in only with your own account, created with your work email address. Your account and password are personal and must not be shared.',
          'Actions taken with your account are treated as yours unless shown otherwise. If you think someone else has used your account, change your password and tell your manager straight away.',
        ],
      },
      {
        h: '3. Requests and approvals',
        p: [
          'Requests are created in the panel, and approvals or rejections are recorded there together with any reason given.',
          'Emails sent by the panel are notifications only. The record in the panel is the authoritative one.',
        ],
      },
      {
        h: '4. Annual leave',
        p: [
          'Annual leave is requested in the panel, and approved leave is kept there as your leave record.',
          'Where the law and the Company allow it, leave may be taken in advance of the entitlement you will accrue.',
          'Once a year you are asked to review and confirm your leave statement in the panel. If something is wrong, do not confirm it: tell your manager and confirm once it has been corrected.',
        ],
      },
      {
        h: '5. Expenses and advances',
        p: ['Upload a photo or scan of the receipt or invoice with each expense claim. Hand the original to the accounting team if your local rules require it; the upload does not replace the original.'],
      },
      {
        h: '6. Company equipment',
        p: [
          'Equipment and software accounts given to you are recorded in the panel. Confirm receipt with "I received it"; this confirmation, together with the serial number and date, serves as the record of handover.',
          'Take reasonable care of assigned equipment, report loss or damage promptly, and return everything when your employment ends.',
          'Responsibility for loss or damage is assessed separately and in line with applicable law. Confirming receipt does not authorise any deduction from your pay.',
        ],
      },
      {
        h: '7. Team leave calendar',
        p: [
          'To help with planning, approved leave is shown on the team calendar with your name and dates. The type of leave and its reason are visible only to authorised managers.',
          'Use calendar information only for work planning. Do not ask colleagues why they are away, speculate about it, or share calendar details outside the panel.',
        ],
      },
      {
        h: '8. Records',
        p: ['Actions in the panel are logged with date, time and user, and every change to a record is kept. These logs may be used as evidence in line with applicable law.'],
      },
      {
        h: '9. Changes to this policy',
        p: ['Updates to this policy are published in the panel. Changes that materially affect your terms of employment are made in writing as required by law.'],
      },
    ],
  },
  privacy: {
    title: 'Employee Privacy Notice — {{APP_NAME}}',
    intro: '{{COMPANY_NAME}} ({{COMPANY_ADDRESS}}; {{COMPANY_REGISTRATION}}) is the controller of the personal data processed in {{APP_NAME}}. This notice explains what we process, why, and the rights you have under the General Data Protection Regulation (GDPR) and other applicable data protection law.',
    sections: [
      {
        h: '1. Data we process',
        p: [
          'Identity and contact details: name, work email address, job title, department, role and language preference.',
          'Account security: a one-way hash of your password (never the password itself), session records, and hashes of invitation and password reset links.',
          'Requests: leave, expense, advance, purchase and travel requests, attached documents, approvals, payments and advance settlements; equipment and software account assignments.',
          'Special category data: medical certificates uploaded for sick leave. Only you and users with a management role can open them; notification emails never include the leave type or health information.',
          'Team calendar: the dates of your approved leave are shown with your name to active colleagues. Leave type, notes and health information are not shown, and pending, rejected or cancelled leave is never shown.',
          'Work records: the name of each person working on a job is visible to colleagues; job amounts and individual shares are visible only to management roles.',
          'Security logs: sign-ins, timestamps, IP address and browser information, including for approvals given through an email link. These logs are used for security, abuse detection and evidence, not for performance monitoring.',
        ],
      },
      {
        h: '2. Purposes and legal bases',
        p: [
          'To run leave, expense, purchase and travel processes and to perform your employment contract (Art. 6(1)(b) GDPR).',
          'To meet legal obligations such as leave, payroll and tax record keeping (Art. 6(1)(c) GDPR).',
          'For our legitimate interests in team planning, asset management, information security and the defence of legal claims (Art. 6(1)(f) GDPR).',
          'Medical certificates are processed only to meet employment and social security obligations (Art. 9(2)(b) GDPR). Confirming that you have read this notice is an acknowledgement, not consent.',
        ],
      },
      {
        h: '3. Recipients and transfers',
        p: [
          'The panel is hosted on Cloudflare; the storage region is chosen at installation. Where data leaves your jurisdiction, appropriate safeguards such as standard contractual clauses are used.',
          'Emails are sent through the email service provider chosen by the Company. Notification emails contain only the request type, dates and amounts.',
          'If accounting emails are enabled, approved leave, expenses, advances and invoices are sent to the Company\'s accountant for payroll and bookkeeping.',
          'Payment details may be shared with the paying bank, and data required by law with competent authorities.',
        ],
      },
      {
        h: '4. Retention',
        p: ['Data is kept for the duration of your employment and afterwards for as long as the law requires, then deleted or anonymised.'],
      },
      {
        h: '5. Your rights',
        p: [
          'You may request access to, correction or erasure of your data, restriction of processing and data portability, and you may object to processing based on legitimate interests.',
          'Send requests to {{CONTACT_EMAIL}}. You also have the right to lodge a complaint with your data protection supervisory authority.',
        ],
      },
    ],
  },
  undertaking: {
    title: 'Electronic Records Acknowledgement',
    items: [
      'I understand that leave, expense, advance, purchase and travel requests and equipment assignments at {{COMPANY_NAME}} (the "Company") are handled in {{APP_NAME}}.',
      'I will sign in only with my own account and will not share my account or password. Actions taken with my account are my own.',
      'My requests and confirmations in the panel ("I received it", "My statement is correct", policy acknowledgements), together with the time and identity records kept by the panel, may be used as evidence in line with applicable law. Actions that the law requires to be in writing are outside this scope.',
      'These confirmations are not a waiver; my statutory rights are unaffected.',
      'I confirm that the Workplace Policy and the Employee Privacy Notice will be made available to me in the panel and that I will read them.',
      'This acknowledgement applies for the duration of my employment and will be signed again if its scope changes. I have received a copy.',
    ],
    signature: { name: 'Full name', date: 'Date', sign: 'Signature', company: 'For the Company' },
  },
  labels: {
    policy: { label: 'Workplace policy', accusative: 'the workplace policy', ack: 'I accept' },
    privacy: { label: 'Privacy notice', accusative: 'the privacy notice', ack: 'I have been informed' },
  },
}
