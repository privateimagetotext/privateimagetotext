import type { GuideContent } from "../guides";
import { routes } from "../routes";

export const checkPhotoLocationBeforePostingGuideContent = {
  slug: "check-photo-location-before-posting",
  introduction: "A phone can record where a photo was taken inside the file itself. Whether those coordinates reach other people depends on your camera settings, how you share and what each app does with the file. Rather than trusting any of those, check the exact file you are about to post. Media Inspector reads it in your browser, flags location fields and, for eligible files, can create a verified copy without them.",
  sections: [
  {
    id: "why-location-matters", heading: "Why a photo can reveal where you were",
    paragraphs: [
      "Most phone cameras can save GPS latitude and longitude in a photo’s EXIF metadata when the camera app has location permission. The coordinates are invisible in the picture but travel with the file. Anyone who receives the original file can read them with ordinary software and paste them into a map. A picture taken at home, a school gate or a regular meeting place can therefore point to a precise spot, together with the date and time it was taken.",
      "Many social and messaging services re-encode photos and drop some metadata from the copy that other people see, but this is not something to rely on. Behaviour differs between services, between sending a photo and sending a file, and it changes over time. A service may also read the metadata itself before removing it from the public copy: Meta’s privacy policy, for example, says it collects metadata about content you provide. Checking the file before it leaves your device is the only step under your control.",
    ],
    links: [{ label: "eSafety Commissioner: stop photo locations on devices", to: "https://www.esafety.gov.au/media/stop-photo-locations-on-devices" }, { label: "Meta privacy policy", to: "https://www.facebook.com/privacy/policy/" }],
  },
  {
    id: "check-the-file", heading: "Check the photo for GPS coordinates",
    steps: [
      "Open Media Inspector and choose Choose media file. Select the exact JPEG, PNG, WebP or GIF you plan to post, not an earlier original or an edited version.",
      "Wait for Inspection complete. The file is read in this browser tab; it is not uploaded.",
      "Open the Privacy tab. A card titled Location information is embedded means recognised coordinates or a named location are present.",
      "Open Raw metadata and type gps in Filter metadata fields to see the latitude, longitude and any altitude, direction or GPS time fields.",
      "Clear the filter. If a Raw XMP packet entry is present, read it for GPS, City or Location text: some editors store location there, and the inspector shows that packet as a single entry rather than separate fields.",
    ],
    callout: "Media Inspector shows coordinates as numbers and does not look them up on a map. If you paste them into a map service to see the place, that service receives them.",
    figures: [{ src: "/guides/check-photo-location-before-posting/privacy-findings.webp", alt: "Media Inspector Privacy tab with a high-attention card reading Location information is embedded and a medium-attention card about creation times", caption: "Real result for a synthetic sample JPEG with GPS tags. The Privacy tab flags location and timestamps before you look at individual fields.", width: 737, height: 481 }],
  },
  {
    id: "read-coordinates", heading: "Read what the coordinates reveal",
    paragraphs: [
      "For this example we added GPS tags pointing at Kings Park, a public park in Perth, to a licensed test photograph of a rose. The Raw metadata table shows the reference (S for south, E for east), the degrees, minutes and seconds, and the decimal values the inspector calculates, about −31.9606 and 115.8478. Decimal coordinates with four or more places identify a spot within roughly ten metres, so treat any precise pair as sensitive.",
      "Look at the dates too. Original capture date/time records when the shutter fired, which can reveal a routine when combined with a place. Camera make and model are less sensitive on their own but can help link several photos to one device.",
    ],
    figures: [{ src: "/guides/check-photo-location-before-posting/gps-fields.webp", alt: "Raw metadata filtered by gps, listing latitude and longitude references, degree components and decimal coordinates for the sample photo", caption: "The filtered Raw metadata table for the same sample. These fields are marked review because they may expose a location.", width: 737, height: 529 }],
  },
  {
    id: "remove-location", heading: "Remove location data from a copy",
    paragraphs: [
      "If the photo is an eligible still JPEG or PNG, choose Create metadata-removed copy below the result tabs. The tool removes supported metadata, including EXIF GPS tags, without re-encoding the image, verifies the result and offers a separate download with a -clean suffix. The original file is not changed. It removes all supported metadata in one action, so dates, camera details and any Content Credentials are removed as well.",
      "Rotated photos and photos with an embedded colour profile, which includes many phone photos, may not be eligible. The button is then unavailable, which does not mean the file is clean; another tool or your phone’s own share option may be needed. Otherwise, choose Replace and open the downloaded copy. In our run, the reopened copy reported No recognised privacy fields were found and no GPS fields remained. Post that copy, not the original.",
    ],
    figures: [{ src: "/guides/check-photo-location-before-posting/clean-copy-privacy.webp", alt: "Media Inspector Privacy tab for the downloaded clean copy showing No recognised privacy fields were found", caption: "The downloaded metadata-removed copy, reopened in the inspector. This confirms the recognised fields are gone, not that the picture reveals nothing.", width: 737, height: 481 }],
    links: [{ label: "Step-by-step: remove photo metadata before sharing", to: routes.guide.removePhotoMetadata }],
  },
  {
    id: "phone-settings", heading: "Stop your phone adding location in future",
    paragraphs: [
      "On an iPhone, go to Settings › Privacy & Security › Location Services › Camera and choose Never. When sharing a single photo, tap Share, then Options at the top of the share sheet, and turn off Location; this applies to that share only. To remove location from a photo in your library, open it, swipe up or tap the info button, tap Adjust next to the location and choose No Location. Labels can vary slightly between iOS versions.",
      "On Android, the setting is in the camera app. In Google’s Pixel Camera, open the camera settings and turn off Save location; on Samsung phones, open Camera settings and turn off Location tags. Other manufacturers use similar names. Google Photos help explains who can see a photo’s location and notes that a downloaded copy can keep the location your device saved. Recheck these settings after a major update, a reset or a new phone.",
    ],
    links: [
      { label: "Apple: manage location metadata in Photos", to: "https://support.apple.com/en-au/guide/personal-safety/ips0d7a5df82/web" },
      { label: "Google: Pixel Camera settings", to: "https://support.google.com/pixelcamera/answer/2838995" },
      { label: "Google Photos: who can see your photo locations", to: "https://support.google.com/photos/answer/11190100" },
    ],
  },
  {
    id: "formats", heading: "iPhone HEIC photos and other formats",
    paragraphs: [
      "Media Inspector reads metadata from JPEG, PNG, WebP and GIF images. It does not currently read HEIC or HEIF photos, the High Efficiency format iPhones use by default, so it cannot show their location fields. If you want to check before posting, export or share a JPEG copy and inspect that copy, or set Settings › Camera › Formats to Most Compatible so new photos are saved as JPEG. Check the file you will actually upload, because conversion can keep, change or drop metadata.",
    ],
  },
  {
    id: "before-you-rely", heading: "Before you rely on this",
    bullets: [
      "No recognised location fields does not prove a file reveals nothing. Unsupported or private metadata blocks may not be decoded.",
      "Metadata is only half the risk. Street signs, house numbers, school uniforms, landmarks, reflections and views from a window can show where you were. Google’s own help notes that people may guess a location from landmarks.",
      "Removing metadata from your copy does not remove it from copies you have already sent, backed up or uploaded.",
      "Platforms change how they process uploads. Do not assume a service strips location; check the file before it leaves your device.",
      "Inspection runs in your browser. Downloads, clipboard history, backups and later uploads are controlled by your device and the services you use.",
    ],
  },
  ],
  faqs: [
  { question: "How can I tell if a photo has location data?", answer: "Open the file in a metadata viewer that reads EXIF, such as Media Inspector, and look for GPS latitude and longitude. On an iPhone, the info panel in Photos shows a map when a location is stored; on Android, Google Photos shows it in the photo details." },
  { question: "Do Instagram and Facebook show my photo location?", answer: "Other people can see any location tag you add to a post and anything visible in the picture. Separately, Meta’s privacy policy says it collects metadata about content you provide, so do not assume the public copy is the only copy it reads. Remove GPS data before posting rather than relying on the platform." },
  { question: "Do screenshots contain location data?", answer: "Screenshots normally do not record GPS coordinates, but they can show a location on screen, such as a map, address or message. They may still carry other metadata, so inspect them if it matters." },
  { question: "Is checking a photo here private?", answer: "Media Inspector reads the file in your browser and does not upload it, its metadata or its fingerprint. You can confirm this with the Verify page, which explains how to watch network requests in your browser’s developer tools." },
  ],
} satisfies GuideContent;
