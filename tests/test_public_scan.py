import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("public_scan", Path(__file__).parents[1] / "scripts/check-public.py")
scan = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scan)


class PublicScanTests(unittest.TestCase):
    def test_detects_non_example_account_without_flagging_decimal_scores(self):
        self.assertTrue(scan.content_findings('"account": "' + "4" * 12 + '"'))
        self.assertFalse(scan.content_findings('"score": 0.553123456789'))
        self.assertFalse(scan.content_findings('"account": "000000000000"'))

    def test_detects_credentials_and_non_example_email_without_printing_them(self):
        credential = "gh" + "p_" + "A" * 36
        findings = scan.content_findings(credential)
        self.assertEqual(findings, [(1, "credential pattern")])
        email = "person" + "@" + "personal.example"
        self.assertTrue(scan.content_findings(email))
        self.assertFalse(scan.content_findings("you@example.com"))

    def test_lock_metadata_exception_does_not_disable_credential_detection(self):
        email = "author" + "@" + "upstream.example"
        self.assertFalse(scan.content_findings(email, dependency_lock=True))
        self.assertTrue(scan.content_findings("AKIA" + "A" * 16, dependency_lock=True))


if __name__ == "__main__": unittest.main()
