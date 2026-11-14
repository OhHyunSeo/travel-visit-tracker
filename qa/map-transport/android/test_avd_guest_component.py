import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from avd_guest_component import PACKET, query_boot_property, receive, require_owned_listener, send


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
