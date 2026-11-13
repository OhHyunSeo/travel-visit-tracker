from pathlib import Path
import plistlib
import unittest

from avd_volume_component import image_device, mount_device
from single_writer_component import ComponentError


class VolumeIdentityTest(unittest.TestCase):
    image = Path('/tmp/owned/capacity.dmg')
    mount = Path('/tmp/owned/mount')

    def test_picks_only_exact_owned_image(self):
        info = plistlib.dumps({'images': [
            {'image-path': str(self.image) + '.other', 'system-entities': [{'dev-entry': '/dev/disk99'}]},
            {'image-path': str(self.image), 'system-entities': [{'dev-entry': '/dev/disk10'}]},
        ]})
        self.assertEqual(image_device(info, self.image), '/dev/disk10')
        self.assertIsNone(image_device(info, Path('/tmp/absent.dmg')))

    def test_ambiguous_or_malformed_attachment_refused(self):
        for entities in ([{'dev-entry': '/dev/disk10'}, {'dev-entry': '/dev/disk11'}],
                         [{'dev-entry': '/dev/disk10s1'}]):
            with self.subTest(entities=entities):
                info = plistlib.dumps({'images': [{'image-path': str(self.image), 'system-entities': entities}]})
                with self.assertRaisesRegex(ComponentError, 'no unique root'):
                    image_device(info, self.image)

    def test_requires_exact_owned_mount_point(self):
        reply = plistlib.dumps({'system-entities': [
            {'dev-entry': '/dev/disk10', 'mount-point': str(self.mount)},
        ]})
        self.assertEqual(mount_device(reply, self.mount), '/dev/disk10')
        with self.assertRaisesRegex(ComponentError, 'whole-device mount'):
            mount_device(reply, Path('/tmp/other'))
