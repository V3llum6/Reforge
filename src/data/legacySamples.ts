import type { EnterpriseSampleTemplate } from '../types';

export const ENTERPRISE_LEGACY_SAMPLES: EnterpriseSampleTemplate[] = [
  {
    key: 'cobol-wire-settlement',
    name: 'FirstNational Core Wire Settlement',
    era: '1999 – 2011 COBOL-85 Batch Engine',
    industry: 'Core Banking & ACH Clearing',
    description:
      'Mainframe COBOL wire clearing and interest accrual batch programs using fixed-point COMP-3 decimals, hardcoded supervisor PIN overrides, and unvalidated operator buffers.',
    sourceLanguage: 'COBOL',
    targetFramework: 'Rust',
    modules: [
      {
        filePath: 'cobol/BATCH-SETTLE.cbl',
        sourceLanguage: 'COBOL',
        lifecycleStatus: 'modernized',
        legacyCode: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. BATCH-SETTLE.
       AUTHOR. CORE-BANKING-SYS-2008.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-SUPERVISOR-PIN       PIC X(04) VALUE '9942'.
       01  WS-INPUT-PIN            PIC X(04).
       01  WS-RAW-MEMO-BUF         PIC X(64).
       01  WS-AUDIT-CMD            PIC X(120).
       01  WS-ACCT-BALANCE         PIC S9(07)V99 COMP-3 VALUE 0.
       01  WS-WIRE-AMOUNT          PIC S9(07)V99 COMP-3 VALUE 0.
       01  WS-FEE-RATE             PIC V9999 COMP-3 VALUE .0025.
       01  WS-COMPUTED-FEE         PIC S9(05)V99 COMP-3 VALUE 0.
       01  WS-STATUS-CODE          PIC 9(02) VALUE 00.

       PROCEDURE DIVISION.
       0000-MAIN-SETTLEMENT.
           ACCEPT WS-INPUT-PIN FROM CONSOLE.
           ACCEPT WS-RAW-MEMO-BUF FROM CONSOLE.
           IF WS-INPUT-PIN = WS-SUPERVISOR-PIN
               GO TO 0200-FORCE-POST
           END-IF.
           IF WS-WIRE-AMOUNT > 5000000.00
               MOVE 14 TO WS-STATUS-CODE
               GO TO 9000-EXIT
           END-IF.

       0100-STANDARD-SETTLEMENT.
           COMPUTE WS-COMPUTED-FEE = WS-WIRE-AMOUNT * WS-FEE-RATE.
           SUBTRACT WS-WIRE-AMOUNT FROM WS-ACCT-BALANCE.
           SUBTRACT WS-COMPUTED-FEE FROM WS-ACCT-BALANCE.
           IF WS-ACCT-BALANCE < 0
               MOVE 51 TO WS-STATUS-CODE
               GO TO 9000-EXIT
           END-IF.
           GO TO 0300-WRITE-AUDIT.

       0200-FORCE-POST.
           SUBTRACT WS-WIRE-AMOUNT FROM WS-ACCT-BALANCE.

       0300-WRITE-AUDIT.
           STRING '/usr/local/bin/post_ledger_log "'
                  WS-RAW-MEMO-BUF
                  '"' DELIMITED BY SIZE
                  INTO WS-AUDIT-CMD.
           CALL 'SYSTEM' USING WS-AUDIT-CMD.
           MOVE 00 TO WS-STATUS-CODE.

       9000-EXIT.
           STOP RUN.`,
        modernizedFilePath: 'src/settlement/batch_settle.rs',
        modernizedCode: `use std::fmt;

/// Fixed-point cents representation preserving exact COBOL PIC S9(07)V99 COMP-3 precision
/// without floating-point rounding drift or silent numeric truncation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct MinorUnits(pub i128);

impl MinorUnits {
    pub const ZERO: Self = Self(0);
    pub const MAX_STANDARD_WIRE: Self = Self(500_000_000); // $5,000,000.00 in cents

    /// Computes a 25 bps (0.25%) settlement fee using checked integer arithmetic
    /// with half-up banker-safe rounding.
    pub fn checked_fee_25bps(self) -> Result<Self, SettlementError> {
        if self.0 < 0 {
            return Err(SettlementError::InvalidWireAmount);
        }
        let numerator = self.0.checked_mul(25).ok_or(SettlementError::ArithmeticOverflow)?;
        let rounded_cents = (numerator + 5_000) / 10_000;
        Ok(Self(rounded_cents))
    }

    pub fn checked_sub(self, rhs: Self) -> Result<Self, SettlementError> {
        self.0
            .checked_sub(rhs.0)
            .map(Self)
            .ok_or(SettlementError::ArithmeticOverflow)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorizationContext {
    StandardAutomated,
    SupervisorOverride { verified_actor_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettlementError {
    InvalidWireAmount,
    LimitExceeded,
    InsufficientFunds,
    ArithmeticOverflow,
    InvalidMemoCharacters,
}

impl fmt::Display for SettlementError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidWireAmount => write!(f, "Wire amount must be strictly positive"),
            Self::LimitExceeded => write!(f, "Wire exceeds $5,000,000.00 automated clearing ceiling"),
            Self::InsufficientFunds => write!(f, "Insufficient settlement balance after fee deduction"),
            Self::ArithmeticOverflow => write!(f, "Checked fixed-point arithmetic overflow"),
            Self::InvalidMemoCharacters => write!(f, "Memo contains disallowed control characters"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEvent {
    pub sanitized_memo: String,
    pub ending_balance: MinorUnits,
    pub fee_charged: MinorUnits,
    pub supervisor_id: Option<String>,
}

pub trait AuditSink {
    fn record_settlement(&mut self, event: AuditEvent);
}

fn sanitize_memo(memo: &str) -> Result<String, SettlementError> {
    let trimmed = memo.trim();
    if trimmed.len() > 64 || trimmed.chars().any(|c| c.is_control()) {
        return Err(SettlementError::InvalidMemoCharacters);
    }
    Ok(trimmed.to_owned())
}

pub fn execute_wire_settlement(
    starting_balance: MinorUnits,
    wire_amount: MinorUnits,
    memo: &str,
    auth: AuthorizationContext,
    audit_sink: &mut impl AuditSink,
) -> Result<MinorUnits, SettlementError> {
    if wire_amount.0 <= 0 {
        return Err(SettlementError::InvalidWireAmount);
    }

    let sanitized_memo = sanitize_memo(memo)?;

    let (ending_balance, fee_charged, supervisor_id) = match auth {
        AuthorizationContext::SupervisorOverride { verified_actor_id } => {
            let next_bal = starting_balance.checked_sub(wire_amount)?;
            (next_bal, MinorUnits::ZERO, Some(verified_actor_id))
        }
        AuthorizationContext::StandardAutomated => {
            if wire_amount > MinorUnits::MAX_STANDARD_WIRE {
                return Err(SettlementError::LimitExceeded);
            }
            let fee = wire_amount.checked_fee_25bps()?;
            let after_principal = starting_balance.checked_sub(wire_amount)?;
            let after_fee = after_principal.checked_sub(fee)?;
            if after_fee < MinorUnits::ZERO {
                return Err(SettlementError::InsufficientFunds);
            }
            (after_fee, fee, None)
        }
    };

    // Structured audit sink replaces unsafe shell CALL 'SYSTEM' concatenation
    audit_sink.record_settlement(AuditEvent {
        sanitized_memo,
        ending_balance,
        fee_charged,
        supervisor_id,
    });

    Ok(ending_balance)
}`,
        unitTestFilePath: 'tests/batch_settle_test.rs',
        unitTestCode: `#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct InMemoryAuditSink {
        events: Vec<AuditEvent>,
    }

    impl AuditSink for InMemoryAuditSink {
        fn record_settlement(&mut self, event: AuditEvent) {
            self.events.push(event);
        }
    }

    #[test]
    fn settles_standard_wire_with_exact_25bps_fee() {
        let mut sink = InMemoryAuditSink::default();
        // Balance: $10,000.00, Wire: $1,000.00 -> Fee: $2.50 -> Ending: $8,997.50
        let result = execute_wire_settlement(
            MinorUnits(1_000_000),
            MinorUnits(100_000),
            "ACH BATCH 4419",
            AuthorizationContext::StandardAutomated,
            &mut sink,
        );

        assert_eq!(result, Ok(MinorUnits(899_750)));
        assert_eq!(sink.events.len(), 1);
        assert_eq!(sink.events[0].fee_charged, MinorUnits(250));
    }

    #[test]
    fn blocks_wires_above_automated_ceiling_without_override() {
        let mut sink = InMemoryAuditSink::default();
        let result = execute_wire_settlement(
            MinorUnits(900_000_000),
            MinorUnits(500_000_001),
            "CORP TREASURY SWEEP",
            AuthorizationContext::StandardAutomated,
            &mut sink,
        );

        assert_eq!(result, Err(SettlementError::LimitExceeded));
        assert!(sink.events.is_empty());
    }

    #[test]
    fn neutralizes_shell_injection_payload_in_memo() {
        let mut sink = InMemoryAuditSink::default();
        // Payload that previously escaped quotes in CALL 'SYSTEM'
        let malicious_memo = "\"; rm -rf /var/ledger; #";
        let result = execute_wire_settlement(
            MinorUnits(500_000),
            MinorUnits(10_000),
            malicious_memo,
            AuthorizationContext::StandardAutomated,
            &mut sink,
        );

        // Memo is stored strictly as inert structured string data, never passed to a shell
        assert!(result.is_ok());
        assert_eq!(sink.events[0].sanitized_memo, malicious_memo);
    }

    #[test]
    fn rejects_insufficient_funds_when_fee_pushes_balance_negative() {
        let mut sink = InMemoryAuditSink::default();
        // Exact principal ($1,000.00) available, but missing $2.50 fee
        let result = execute_wire_settlement(
            MinorUnits(100_000),
            MinorUnits(100_000),
            "TIGHT BALANCE TEST",
            AuthorizationContext::StandardAutomated,
            &mut sink,
        );

        assert_eq!(result, Err(SettlementError::InsufficientFunds));
    }
}`,
        summary:
          'Replaced unstructured COBOL GO TO control flow, hardcoded console PIN bypass, and shell command concatenation with a pure, memory-safe Rust settlement domain module using checked i128 minor-unit fixed-point arithmetic and a structured AuditSink trait.',
        refactoringNotes: [
          'Replaced PIC S9(07)V99 COMP-3 packed decimals with checked i128 MinorUnits to prevent silent COBOL high-order digit truncation.',
          'Eliminated 4 spaghetti GO TO paragraphs into exhaustive match expressions on AuthorizationContext.',
          'Removed hardcoded WS-SUPERVISOR-PIN = 9942 in favor of caller-verified AuthorizationContext::SupervisorOverride.',
          'Replaced CALL SYSTEM shell string interpolation with a strongly-typed AuditSink trait.',
        ],
        vulnerabilities: [
          {
            cwe: 'CWE-78',
            severity: 'Critical',
            title: 'OS Command Injection via Unsanitized Memo Buffer in CALL SYSTEM',
            lineRange: 'Lines 43-48',
            description:
              'WS-RAW-MEMO-BUF is read directly via ACCEPT and concatenated inside double quotes into WS-AUDIT-CMD before invoking CALL \'SYSTEM\'. An attacker supplying `"; /bin/sh #` executes arbitrary OS commands under the mainframe batch service account.',
            remediation:
              'Eliminated shell invocation entirely in Rust; audit events are emitted as structured AuditEvent structs through the AuditSink trait with control-character validation.',
          },
          {
            cwe: 'CWE-798',
            severity: 'Critical',
            title: 'Hardcoded Supervisor Override PIN Bypassing Wire Limits & Overdraft Checks',
            lineRange: 'Lines 6, 19-21',
            description:
              'WORKING-STORAGE embeds plaintext PIN `9942` (`WS-SUPERVISOR-PIN`) which jumps directly to `0200-FORCE-POST`, bypassing both the $5M wire cap and negative balance checks.',
            remediation:
              'Removed embedded credentials from code and modeled explicit authenticated authorization via `AuthorizationContext::SupervisorOverride { verified_actor_id }`.',
          },
          {
            cwe: 'CWE-190',
            severity: 'High',
            title: 'Silent Fixed-Point Truncation & Missing ON SIZE ERROR Guard',
            lineRange: 'Lines 10-13, 29-31',
            description:
              'COBOL `COMPUTE` and `SUBTRACT` statements omit `ON SIZE ERROR`. Overflows exceeding `PIC S9(07)V99` silently truncate leading digits, corrupting ledger balances.',
            remediation:
              'Implemented `checked_mul` and `checked_sub` over 128-bit integer minor units returning explicit `SettlementError::ArithmeticOverflow`.',
          },
        ],
      },
      {
        filePath: 'cobol/INTEREST-CALC.cbl',
        sourceLanguage: 'COBOL',
        lifecycleStatus: 'draft',
        legacyCode: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTEREST-CALC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-DB-CONN-STR      PIC X(80) VALUE 'UID=DB2ADMIN;PWD=WINTER2009;'.
       01  WS-PRINCIPAL        PIC 9(08)V99 COMP-3.
       01  WS-ANNUAL-RATE      PIC V99999 COMP-3.
       01  WS-DAYS-ACCRUED     PIC 9(04) COMP.
       01  WS-ACCRUED-INT      PIC 9(06)V99 COMP-3.
       01  WS-SQL-QUERY        PIC X(240).
       01  WS-ACCT-ID          PIC X(24).

       PROCEDURE DIVISION.
       1000-CALC-ACCRUAL.
           ACCEPT WS-ACCT-ID.
           IF WS-DAYS-ACCRUED = 0
               GO TO 9999-DONE
           END-IF.
           COMPUTE WS-ACCRUED-INT =
               (WS-PRINCIPAL * WS-ANNUAL-RATE * WS-DAYS-ACCRUED) / 360.
           STRING "UPDATE ACCT_LEDGER SET INT_DUE = "
                  WS-ACCRUED-INT
                  " WHERE ACCT_NUM = '"
                  WS-ACCT-ID "'"
                  DELIMITED BY SIZE INTO WS-SQL-QUERY.
           CALL 'EXECSQL' USING WS-DB-CONN-STR WS-SQL-QUERY.
       9999-DONE.
           GOBACK.`,
        modernizedFilePath: '',
        modernizedCode: '',
        unitTestFilePath: '',
        unitTestCode: '',
        summary: '',
        refactoringNotes: [],
        vulnerabilities: [],
      },
    ],
  },
  {
    key: 'java8-erp-monolith',
    name: 'OmniOrder Legacy Java 8 ERP',
    era: '2011 Java Servlet & Raw JDBC Monolith',
    industry: 'B2B Supply Chain & Invoicing',
    description:
      'Legacy Java Servlet handling invoice lookups, serialized session tokens, MD5 credential checks, and non-thread-safe static formatters.',
    sourceLanguage: 'Java 8',
    targetFramework: 'Node.js',
    modules: [
      {
        filePath: 'src/com/omniorder/web/OrderInvoiceServlet.java',
        sourceLanguage: 'Java 8',
        lifecycleStatus: 'modernized',
        legacyCode: `package com.omniorder.web;

import java.io.*;
import java.security.MessageDigest;
import java.sql.*;
import java.text.SimpleDateFormat;
import java.util.Base64;
import javax.servlet.http.*;

public class OrderInvoiceServlet extends HttpServlet {
    // Shared across all servlet threads!
    private static final SimpleDateFormat ISO_FMT = new SimpleDateFormat("yyyy-MM-dd");
    private static final String JDBC_URL = "jdbc:mysql://10.0.4.19:3306/erp?user=root&password=ErpRoot!11";

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String customerCode = req.getParameter("customerCode");
        String sessionBlob = req.getParameter("prefsBlob");

        try {
            if (sessionBlob != null && !sessionBlob.isEmpty()) {
                byte[] raw = Base64.getDecoder().decode(sessionBlob);
                ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(raw));
                Object prefs = ois.readObject();
                req.setAttribute("prefs", prefs);
            }

            Connection conn = DriverManager.getConnection(JDBC_URL);
            Statement stmt = conn.createStatement();
            String sql = "SELECT id, total_cents, created_at FROM invoices WHERE customer_code = '"
                + customerCode + "' ORDER BY created_at DESC";
            ResultSet rs = stmt.executeQuery(sql);

            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            while (rs.next()) {
                if (!first) out.append(",");
                first = false;
                out.append("{\\"id\\":").append(rs.getLong("id"))
                   .append(",\\"totalCents\\":").append(rs.getLong("total_cents"))
                   .append(",\\"date\\":\\"").append(ISO_FMT.format(rs.getDate("created_at"))).append("\\"}");
            }
            out.append("]");
            resp.setContentType("application/json");
            resp.getWriter().write(out.toString());
        } catch (Exception e) {
            e.printStackTrace(resp.getWriter());
        }
    }

    public static String hashLegacyApiToken(String token) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(token.getBytes("UTF-8"));
        return Base64.getEncoder().encodeToString(digest);
    }
}`,
        modernizedFilePath: 'src/invoices/orderInvoiceService.ts',
        modernizedCode: `import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

export interface InvoiceRow {
  id: number;
  totalCents: number;
  createdAt: Date;
}

export interface InvoiceDto {
  id: number;
  totalCents: number;
  date: string;
}

export interface UserPreferences {
  currency: 'USD' | 'EUR' | 'GBP';
  compactRows: boolean;
}

export interface InvoiceRepository {
  findByCustomerCode(customerCode: string): Promise<InvoiceRow[]>;
}

const CUSTOMER_CODE_PATTERN = /^[A-Z0-9_-]{2,32}$/;

export function parseSafePreferences(encodedJson?: string): UserPreferences | null {
  if (!encodedJson) return null;
  if (encodedJson.length > 4096) {
    throw new Error('Preferences payload exceeds safe size limit');
  }
  const decoded = Buffer.from(encodedJson, 'base64').toString('utf8');
  const parsed: unknown = JSON.parse(decoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid preferences object structure');
  }
  const candidate = parsed as Record<string, unknown>;
  const currency = candidate.currency;
  if (currency !== 'USD' && currency !== 'EUR' && currency !== 'GBP') {
    throw new Error('Unsupported currency preference');
  }
  if (typeof candidate.compactRows !== 'boolean') {
    throw new Error('Invalid compactRows flag');
  }
  return { currency, compactRows: candidate.compactRows };
}

export function formatIsoDateUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid invoice date');
  }
  return date.toISOString().slice(0, 10);
}

export async function lookupCustomerInvoices(
  repo: InvoiceRepository,
  customerCode: string,
  prefsBlob?: string
): Promise<{ invoices: InvoiceDto[]; preferences: UserPreferences | null }> {
  const normalizedCode = customerCode.trim().toUpperCase();
  if (!CUSTOMER_CODE_PATTERN.test(normalizedCode)) {
    throw new Error('Invalid customerCode format');
  }

  const preferences = parseSafePreferences(prefsBlob);
  // Parameterized repository call replaces raw SQL string concatenation
  const rows = await repo.findByCustomerCode(normalizedCode);

  const invoices: InvoiceDto[] = rows.map((row) => ({
    id: row.id,
    totalCents: row.totalCents,
    date: formatIsoDateUtc(row.createdAt),
  }));

  return { invoices, preferences };
}

export function hashApiTokenScrypt(token: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const derived = scryptSync(token, salt, 32);
  return \`\${salt.toString('hex')}:\${derived.toString('hex')}\`;
}

export function verifyApiTokenScrypt(token: string, storedHash: string): boolean {
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(token, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}`,
        unitTestFilePath: 'tests/orderInvoiceService.test.ts',
        unitTestCode: `import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupCustomerInvoices,
  parseSafePreferences,
  hashApiTokenScrypt,
  verifyApiTokenScrypt,
  type InvoiceRepository,
} from '../src/invoices/orderInvoiceService.ts';

test('lookupCustomerInvoices returns formatted UTC dates and blocks SQLi payloads', async () => {
  let capturedCode = '';
  const fakeRepo: InvoiceRepository = {
    async findByCustomerCode(code: string) {
      capturedCode = code;
      return [
        { id: 501, totalCents: 149900, createdAt: new Date('2026-03-15T12:00:00Z') },
      ];
    },
  };

  // Classic SQL injection payload must be rejected before hitting the repository
  await assert.rejects(
    () => lookupCustomerInvoices(fakeRepo, "ACME' OR '1'='1"),
    /Invalid customerCode format/
  );

  const res = await lookupCustomerInvoices(fakeRepo, 'acme_01');
  assert.equal(capturedCode, 'ACME_01');
  assert.deepEqual(res.invoices, [
    { id: 501, totalCents: 149900, date: '2026-03-15' },
  ]);
});

test('parseSafePreferences validates schema and rejects arbitrary gadget payloads', () => {
  const validPayload = Buffer.from(
    JSON.stringify({ currency: 'EUR', compactRows: true })
  ).toString('base64');

  assert.deepEqual(parseSafePreferences(validPayload), {
    currency: 'EUR',
    compactRows: true,
  });

  const gadgetAttempt = Buffer.from(
    JSON.stringify({ '@class': 'com.sun.rowset.JdbcRowSetImpl', currency: 'BTC' })
  ).toString('base64');

  assert.throws(() => parseSafePreferences(gadgetAttempt), /Unsupported currency/);
});

test('scrypt API token hashing verifies deterministically with timing-safe equality', () => {
  const hash = hashApiTokenScrypt('tok_live_secret_991');
  assert.equal(verifyApiTokenScrypt('tok_live_secret_991', hash), true);
  assert.equal(verifyApiTokenScrypt('tok_wrong', hash), false);
});`,
        summary:
          'Migrated legacy Java Servlet into a stateless, dependency-injected Node.js TypeScript service. Eliminated Java ObjectInputStream RCE deserialization, SQL string concatenation, unsalted MD5 hashing, connection leaks, and SimpleDateFormat race conditions.',
        refactoringNotes: [
          'Replaced unsafe Java ObjectInputStream.readObject() with strict JSON schema validation over bounded Base64 payloads.',
          'Extracted raw JDBC Statement concatenation behind a parameterized InvoiceRepository interface with strict regex validation.',
          'Upgraded unsalted MD5 digest to salted Node crypto.scryptSync with timingSafeEqual verification.',
          'Replaced static mutable SimpleDateFormat (concurrency bug) and stack-trace leakage with pure UTC ISO date formatting.',
        ],
        vulnerabilities: [
          {
            cwe: 'CWE-502',
            severity: 'Critical',
            title: 'Remote Code Execution via Untrusted ObjectInputStream Deserialization',
            lineRange: 'Lines 21-25',
            description:
              'Request parameter `prefsBlob` is Base64-decoded and passed directly to `new ObjectInputStream(...).readObject()`, allowing unauthenticated attackers to trigger gadget-chain RCE.',
            remediation:
              'Replaced binary object deserialization with `parseSafePreferences`, enforcing a 4KB size cap and strict allowlist property validation.',
          },
          {
            cwe: 'CWE-89',
            severity: 'Critical',
            title: 'SQL Injection in Invoice Lookup Statement',
            lineRange: 'Lines 30-32',
            description:
              '`customerCode` from HTTP POST parameters is concatenated directly into a raw SQL query executed via `Statement.executeQuery`, enabling full database exfiltration.',
            remediation:
              'Enforced `CUSTOMER_CODE_PATTERN` validation and delegated queries exclusively through a parameterized `InvoiceRepository`.',
          },
          {
            cwe: 'CWE-798',
            severity: 'High',
            title: 'Hardcoded Root Database Credentials & Stack Trace Disclosure',
            lineRange: 'Lines 13, 47',
            description:
              '`JDBC_URL` embeds root MySQL credentials in source code, and catch blocks print full Java stack traces directly to the HTTP response body (`CWE-209`).',
            remediation:
              'Decoupled database credentials from application logic via injected repository configuration and removed raw stack trace serialization.',
          },
          {
            cwe: 'CWE-328',
            severity: 'Medium',
            title: 'Weak Unsalted MD5 Cryptographic Hash for API Tokens',
            lineRange: 'Lines 51-55',
            description:
              '`hashLegacyApiToken` computes an unsalted MD5 digest vulnerable to fast GPU collision and rainbow-table precomputation.',
            remediation:
              'Replaced MD5 with salted `scryptSync` key derivation and constant-time `timingSafeEqual` comparison.',
          },
        ],
      },
      {
        filePath: 'src/com/omniorder/dao/InventorySyncDao.java',
        sourceLanguage: 'Java 8',
        lifecycleStatus: 'draft',
        legacyCode: `package com.omniorder.dao;

import java.io.File;
import java.sql.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;

public class InventorySyncDao {
    public Document parseSupplierFeedXml(String xmlFilePath) throws Exception {
        // Legacy supplier XML feed parser (Java 8 defaults allow XXE!)
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        return dbf.newDocumentBuilder().parse(new File("/var/feeds/" + xmlFilePath));
    }

    public void adjustSkuQuantity(Connection conn, String sku, String deltaRaw) throws SQLException {
        Statement st = conn.createStatement();
        st.executeUpdate(
            "UPDATE warehouse_stock SET qty = qty + " + deltaRaw + " WHERE sku = '" + sku + "'"
        );
    }
}`,
        modernizedFilePath: '',
        modernizedCode: '',
        unitTestFilePath: '',
        unitTestCode: '',
        summary: '',
        refactoringNotes: [],
        vulnerabilities: [],
      },
    ],
  },
  {
    key: 'php5-checkout-portal',
    name: 'MerchantPay PHP 5.4 Checkout',
    era: '2010 Procedural PHP & Inline MySQL',
    industry: 'E-Commerce Payments & Promotions',
    description:
      'Legacy spaghetti PHP checkout mixing deprecated mysql_query calls, reflected XSS promo banners, and unvalidated client-side discount math.',
    sourceLanguage: 'PHP',
    targetFramework: 'React',
    modules: [
      {
        filePath: 'public/checkout_portal.php',
        sourceLanguage: 'PHP',
        lifecycleStatus: 'modernized',
        legacyCode: `<?php
session_start();
mysql_connect("localhost", "shop_web", "webpass2010");
mysql_select_db("merchant_db");

$promo = $_GET['promo'];
$discount_pct = isset($_POST['discount_pct']) ? $_POST['discount_pct'] : 0;
$subtotal = 240.00;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $card_num = $_POST['card_number'];
    $final_total = $subtotal - ($subtotal * ($discount_pct / 100));
    $q = "INSERT INTO orders (user_id, card_raw, total) VALUES ("
       . $_SESSION['uid'] . ", '" . $card_num . "', " . $final_total . ")";
    mysql_query($q);
    $msg = "Order charged: $" . $final_total;
}
?>
<div class="checkout-box">
  <h2>Complete Your Purchase</h2>
  <?php if ($promo) { echo "<div class='promo'>Applied promo: " . $promo . "</div>"; } ?>
  <?php if ($msg) { echo "<p>" . $msg . "</p>"; } ?>
  <form method="POST" action="checkout_portal.php">
    <input type="hidden" name="discount_pct" value="15" />
    <label>Card Number</label>
    <input type="text" name="card_number" />
    <button type="submit">Charge Card</button>
  </form>
</div>`,
        modernizedFilePath: 'src/components/CheckoutSummaryForm.tsx',
        modernizedCode: `import React, { useMemo, useState } from 'react';

export interface VerifiedPromotion {
  code: string;
  discountBps: number; // e.g., 1500 = 15.00% verified server-side
}

export interface CheckoutSubmission {
  paymentMethodToken: string;
  promoCode: string | null;
  idempotencyKey: string;
}

export interface CheckoutSummaryFormProps {
  subtotalCents: number;
  verifiedPromotion?: VerifiedPromotion | null;
  onTokenizeCard: (last4Preview: string) => Promise<string>;
  onSubmitOrder: (payload: CheckoutSubmission) => Promise<{ orderId: string; chargedCents: number }>;
}

export function calculateDiscountedTotalCents(
  subtotalCents: number,
  discountBps: number
): { discountCents: number; finalTotalCents: number } {
  const safeSubtotal = Math.max(0, Math.trunc(subtotalCents));
  const clampedBps = Math.min(Math.max(0, Math.trunc(discountBps)), 10_000);
  const discountCents = Math.round((safeSubtotal * clampedBps) / 10_000);
  return {
    discountCents,
    finalTotalCents: Math.max(0, safeSubtotal - discountCents),
  };
}

function formatUsd(cents: number): string {
  return \`$\${(cents / 100).toFixed(2)}\`;
}

export const CheckoutSummaryForm: React.FC<CheckoutSummaryFormProps> = ({
  subtotalCents,
  verifiedPromotion = null,
  onTokenizeCard,
  onSubmitOrder,
}) => {
  const [cardLast4Input, setCardLast4Input] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { discountCents, finalTotalCents } = useMemo(
    () => calculateDiscountedTotalCents(subtotalCents, verifiedPromotion?.discountBps ?? 0),
    [subtotalCents, verifiedPromotion?.discountBps]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const digitsOnly = cardLast4Input.replace(/\\D/g, '');
    if (digitsOnly.length < 4) {
      setErrorMessage('Enter valid payment details to tokenize via PCI vault.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Never transmit or store raw PAN; exchange via PCI-scoped tokenizer
      const paymentMethodToken = await onTokenizeCard(digitsOnly.slice(-4));
      const result = await onSubmitOrder({
        paymentMethodToken,
        promoCode: verifiedPromotion?.code ?? null,
        idempotencyKey: crypto.randomUUID(),
      });
      setStatusMessage(\`Order #\${result.orderId} authorized for \${formatUsd(result.chargedCents)}\`);
      setCardLast4Input('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Checkout authorization failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-label="Checkout Summary" className="max-w-md space-y-4">
      <h2 className="text-lg font-semibold">Complete Your Purchase</h2>

      {verifiedPromotion && (
        <p className="text-sm" data-testid="promo-banner">
          Applied promo: {verifiedPromotion.code} ({(verifiedPromotion.discountBps / 100).toFixed(0)}% off)
        </p>
      )}

      <dl className="space-y-1 text-sm tabular-nums">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{formatUsd(subtotalCents)}</dd>
        </div>
        {discountCents > 0 && (
          <div className="flex justify-between">
            <dt>Verified Discount</dt>
            <dd>-{formatUsd(discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <dt>Total Due</dt>
          <dd data-testid="final-total">{formatUsd(finalTotalCents)}</dd>
        </div>
      </dl>

      {statusMessage && <p role="status" className="text-sm">{statusMessage}</p>}
      {errorMessage && <p role="alert" className="text-sm">{errorMessage}</p>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="vault-card-input" className="block text-sm font-medium">
            Card Details (Tokenized)
          </label>
          <input
            id="vault-card-input"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            value={cardLast4Input}
            onChange={(e) => setCardLast4Input(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded px-4 py-2 text-sm font-medium"
        >
          {isSubmitting ? 'Authorizing...' : \`Authorize \${formatUsd(finalTotalCents)}\`}
        </button>
      </form>
    </section>
  );
};`,
        unitTestFilePath: 'src/components/CheckoutSummaryForm.test.tsx',
        unitTestCode: `import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  CheckoutSummaryForm,
  calculateDiscountedTotalCents,
} from './CheckoutSummaryForm';

describe('calculateDiscountedTotalCents', () => {
  it('clamps out-of-range discount percentages to prevent negative order totals', () => {
    // Attacker attempting 500% discount (50,000 bps) is clamped to 100% max
    const clamped = calculateDiscountedTotalCents(24_000, 50_000);
    expect(clamped.finalTotalCents).toBe(0);

    const standard15Pct = calculateDiscountedTotalCents(24_000, 1_500);
    expect(standard15Pct.discountCents).toBe(3_600);
    expect(standard15Pct.finalTotalCents).toBe(20_400);
  });
});

describe('CheckoutSummaryForm security & tokenization behavior', () => {
  it('escapes XSS payloads in promo codes and submits tokenized payment instruments only', async () => {
    const onTokenizeCard = vi.fn().mockResolvedValue('tok_visa_4242');
    const onSubmitOrder = vi.fn().mockResolvedValue({
      orderId: 'ORD-901',
      chargedCents: 20_400,
    });

    const xssPromo = '<script>window.__hacked=true</script>';
    render(
      <CheckoutSummaryForm
        subtotalCents={24_000}
        verifiedPromotion={{ code: xssPromo, discountBps: 1_500 }}
        onTokenizeCard={onTokenizeCard}
        onSubmitOrder={onSubmitOrder}
      />
    );

    // React escapes the text node automatically; no script tag injected
    expect(screen.getByTestId('promo-banner').textContent).toContain(xssPromo);
    expect(screen.getByTestId('final-total').textContent).toBe('$204.00');

    fireEvent.change(screen.getByLabelText(/Card Details/i), {
      target: { value: '4242424242424242' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }));

    await waitFor(() => {
      expect(onTokenizeCard).toHaveBeenCalledWith('4242');
      expect(onSubmitOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodToken: 'tok_visa_4242',
          promoCode: xssPromo,
        })
      );
    });
  });
});`,
        summary:
          'Extracted spaghetti PHP 5.4 HTML/SQL checkout script into a typed React 19 component backed by PCI tokenization, server-verified promotion props, automatic JSX output encoding, and integer-cents price math.',
        refactoringNotes: [
          'Eliminated reflected XSS (`echo $_GET["promo"]`) via automatic React JSX text escaping.',
          'Removed client-modifiable `<input type="hidden" name="discount_pct">` price tampering vulnerability; discounts now derive strictly from server-verified `VerifiedPromotion` props.',
          'Replaced plaintext `card_raw` SQL storage (`PCI-DSS` violation + SQLi) with `onTokenizeCard` vault tokenization and idempotency keys.',
        ],
        vulnerabilities: [
          {
            cwe: 'CWE-79',
            severity: 'High',
            title: 'Reflected Cross-Site Scripting (XSS) via Unescaped Promo Parameter',
            lineRange: 'Lines 6, 21',
            description:
              '`$_GET["promo"]` is echoed directly into the HTML DOM without `htmlspecialchars()`, enabling session theft and checkout skimming.',
            remediation:
              'Rendered promotional strings strictly as escaped React text nodes inside `CheckoutSummaryForm`.',
          },
          {
            cwe: 'CWE-472',
            severity: 'Critical',
            title: 'Client-Side Price Tampering via Hidden `discount_pct` Form Input',
            lineRange: 'Lines 7, 12, 24',
            description:
              'Order total is calculated directly from `$_POST["discount_pct"]` submitted in a hidden HTML field. Attackers can post `discount_pct=100` or `200` to purchase items for $0 or negative amounts.',
            remediation:
              'Removed hidden discount form inputs; client submits only the promo code and payment token while bounding math with `calculateDiscountedTotalCents`.',
          },
          {
            cwe: 'CWE-312',
            severity: 'Critical',
            title: 'Plaintext Credit Card PAN Storage & SQL Injection in Order Insert',
            lineRange: 'Lines 11, 13-15',
            description:
              'Raw credit card numbers (`$card_num`) are concatenated unsafely into an `INSERT INTO orders` query via deprecated `mysql_query()`, exposing PAN data and SQL injection simultaneously.',
            remediation:
              'Replaced raw card handling with `onTokenizeCard` vault tokenization so raw PANs never touch application persistence.',
          },
        ],
      },
      {
        filePath: 'public/invoice_history.php',
        sourceLanguage: 'PHP',
        lifecycleStatus: 'draft',
        legacyCode: `<?php
mysql_connect("localhost", "shop_web", "webpass2010");
mysql_select_db("merchant_db");

$sort = isset($_GET['sort']) ? $_GET['sort'] : 'created_at DESC';
$search = isset($_GET['q']) ? $_GET['q'] : '';

$res = mysql_query("SELECT id, memo, total, receipt_file FROM orders WHERE memo LIKE '%" . $search . "%' ORDER BY " . $sort);

if (isset($_GET['download'])) {
    // Legacy receipt download handler
    readfile("/var/www/receipts/" . $_GET['download']);
    exit;
}
?>
<table>
<?php while ($row = mysql_fetch_assoc($res)) { ?>
  <tr>
    <td><?php echo $row['id']; ?></td>
    <td><?php echo $row['memo']; ?></td>
    <td>$<?php echo $row['total']; ?></td>
    <td><a href="?download=<?php echo $row['receipt_file']; ?>">Receipt</a></td>
  </tr>
<?php } ?>
</table>`,
        modernizedFilePath: '',
        modernizedCode: '',
        unitTestFilePath: '',
        unitTestCode: '',
        summary: '',
        refactoringNotes: [],
        vulnerabilities: [],
      },
    ],
  },
];
