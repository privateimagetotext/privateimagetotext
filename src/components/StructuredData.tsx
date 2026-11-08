import { useSyncExternalStore } from "react";
import { guideContentsSnapshot, subscribeGuideContents } from "../config/guide-content-store";
import { serializeStructuredData, structuredDataForPath, type StructuredDataDates } from "../config/structured-data";

export function StructuredData({ pathname, dates }: { pathname: string; dates: StructuredDataDates }) {
  // Guide steps arrive with the lazily loaded guide route; re-render when they do.
  const contents = useSyncExternalStore(subscribeGuideContents, guideContentsSnapshot, guideContentsSnapshot);
  return <script type="application/ld+json" data-site-structured-data="true"
    dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredDataForPath(pathname, dates, contents)) }} />;
}
