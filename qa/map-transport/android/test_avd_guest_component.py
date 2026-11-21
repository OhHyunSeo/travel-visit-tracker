import socket
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from avd_guest_component import PACKET, query_boot_property, receive, require_owned_listener, send, stream_output


class GuestTransportTest(unittest.TestCase):
    def test_packet_round_trip(self):
        outgoing, incoming = socket.socketpair()
        with outgoing, incoming:
            send(outgoing, b'WRTE', 4, 9, b'trial')
            self.assertEqual(receive(incoming), (b'WRTE', 4, 9, b'trial'))

    def test_rejects_over_limit_packet_before_waiting_for_body(self):
        outgoing, incoming = socket.socketpair()
        with outgoing, incoming:
            magic = int.from_bytes(b'WRTE', 'little') ^ 0xFFFFFFFF
            outgoing.sendall(PACKET.pack(b'WRTE', 4, 9, 4097, 0, magic))
            with self.assertRaisesRegex(ValueError, 'header'):
                receive(incoming)

    def test_stream_accepts_empty_ack_before_output(self):
        guest, host = socket.socketpair()
        with guest, host:
            guest.settimeout(1)
            host.settimeout(1)
            send(guest, b'OKAY', 4, 1)
            send(guest, b'WRTE', 4, 1, b'Success\n')
            send(guest, b'CLSE', 4, 1)

            self.assertEqual(stream_output(host, 4, 32, time.monotonic() + 1), b'Success\n')
            self.assertEqual(receive(guest), (b'OKAY', 1, 4, b''))

    def test_stream_rejects_ack_for_another_stream(self):
        guest, host = socket.socketpair()
        with guest, host:
            host.settimeout(1)
            send(guest, b'OKAY', 5, 1)
            with self.assertRaisesRegex(ValueError, 'stream ID'):
                stream_output(host, 4, 32, time.monotonic() + 1)

    def test_unowned_listener_denies_connection_before_using_key(self):
        with tempfile.TemporaryDirectory() as directory:
            key_path = Path(directory) / 'key-that-does-not-exist'
            with patch('avd_guest_component.subprocess.run') as lsof:
                lsof.return_value.returncode = 0
                lsof.return_value.stdout = 'p111\np222\n'
                with patch('avd_guest_component.socket.create_connection') as connect:
                    with self.assertRaisesRegex(ValueError, 'unique local guest'):
                        query_boot_property(key_path)
                    connect.assert_not_called()

    def test_lsof_socket_fields_do_not_count_as_separate_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            key = root / 'android-config/adbkey'
            results = [
                (0, 'p111\nf32\nf33\n'),
                (0, f'p111\nfcwd\nn{root}\nn{root}/avd/fixture.avd/userdata-qemu.img.qcow2\n'),
            ]
            with patch('avd_guest_component.subprocess.run') as lsof:
                from subprocess import CompletedProcess
                lsof.side_effect = [CompletedProcess([], code, output) for code, output in results]
                require_owned_listener(key)
