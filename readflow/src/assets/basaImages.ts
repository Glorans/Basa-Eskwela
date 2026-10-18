/**
 * Local image imports for the ReadFlow UI.
 *
 * Drop your image files into src/assets/basa/ using the filenames below
 * (or rename the imports to match whatever you actually saved), then this
 * file exports them all together so components can pull from BASA_IMAGES.
 *
 * Anything left as "" renders as a small dashed placeholder box (see
 * ImagePlaceholder) instead of breaking the layout, so you can wire these
 * up one at a time — just delete the `import` line and the "" default
 * takes over automatically for that key.
 */

import xpStar from "./basa/xp-star.png";
import mascotThumbsUp from "./basa/mascot-thumbsup.png";
import mascotClassroom from "./basa/mascot-classroom.png";
import podiumGraphic from "./basa/podium-graphic.png";

export const BASA_IMAGES = {
  /** Small star icon inside the XP pill in the top header. */
  xpStar,
  /** Thumbs-up mascot pose on the My Badges page. */
  mascotThumbsUp,
  /** Standing mascot pose on the Join Classroom card. */
  mascotClassroom,
  /** Podium bar-chart illustration on the Leaderboard page. */
  podiumGraphic,
};
