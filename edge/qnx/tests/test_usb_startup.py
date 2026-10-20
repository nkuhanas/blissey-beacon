"""Regression: a temporarily missing port must not spawn a second USB driver."""
import unittest
from unittest.mock import patch, Mock
from boot import wait_for_serial as serial

class SerialStartupTest(unittest.TestCase):
    def test_existing_port_needs_no_launcher(self):
        with patch.object(serial.os.path, "exists", return_value=True), patch.object(serial.subprocess, "run") as run:
            self.assertTrue(serial.ensure_serial("/dev/serusb1"))
            run.assert_not_called()

    def test_missing_watchdog_fails_without_bare_driver(self):
        with patch.object(serial.os.path, "exists", return_value=False), patch.object(serial.os.path, "isfile", return_value=False), patch.object(serial.subprocess, "run") as run:
            self.assertFalse(serial.ensure_serial("/dev/serusb1", log=lambda _: None))
            run.assert_not_called()

    def test_transient_missing_port_uses_singleton_supervisor(self):
        with patch.object(serial.os.path, "exists", side_effect=[False, True]), patch.object(serial.os.path, "isfile", return_value=True), patch.object(serial.subprocess, "run", return_value=Mock(returncode=0)) as run:
            self.assertTrue(serial.ensure_serial("/dev/serusb1", log=lambda _: None))
            self.assertEqual(run.call_args.args[0], ["sudo", "-n", "on", "-d", "/usr/bin/python3", "-I", "-B", serial.WATCHDOG])

    def test_permission_failure_does_not_prompt_or_retry_default_driver(self):
        with patch.object(serial.os.path, "exists", return_value=False), patch.object(serial.os.path, "isfile", return_value=True), patch.object(serial.subprocess, "run", return_value=Mock(returncode=1)) as run:
            self.assertFalse(serial.ensure_serial("/dev/serusb1", log=lambda _: None))
            self.assertEqual(run.call_count, 1)
            self.assertIn("-n", run.call_args.args[0])

    def test_missing_receiver_times_out(self):
        with patch.object(serial.os.path, "exists", return_value=False), patch.object(serial.os.path, "isfile", return_value=True), patch.object(serial.subprocess, "run", return_value=Mock(returncode=0)) as run:
            self.assertFalse(serial.ensure_serial("/dev/serusb1", wait=0, log=lambda _: None))
            self.assertEqual(run.call_count, 1)

if __name__ == "__main__":
    unittest.main()
