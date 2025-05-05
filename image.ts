import path from "path";

export function findSubImagePosition(
  grayImage: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  },
  graySubImage: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  },
  tolerance: number
): { x: number; y: number; width: number; height: number } | null {
  const srcData = grayImage.data;
  const srcWidth = grayImage.width;
  const srcHeight = grayImage.height;

  const subData = graySubImage.data;
  const subWidth = graySubImage.width;
  const subHeight = graySubImage.height;

  // Loop through the main image pixel data
  for (let srcY = 0; srcY < srcHeight - subHeight; srcY++) {
    for (let srcX = 0; srcX < srcWidth - subWidth; srcX++) {
      let match = true;

      // Compare pixel data of the sub image with the main image
      for (let subY = 0; subY < subHeight && match; subY++) {
        for (let subX = 0; subX < subWidth && match; subX++) {
          // ignore white pixels in sub image

          if (subData[subY * subWidth + subX] > 200) {
            // console.log("white",subY, subX);
            continue;
          }

          if (
            Math.abs(
              srcData[(srcY + subY) * srcWidth + srcX + subX] -
                subData[subY * subWidth + subX]
            ) > tolerance
          ) {
            match = false;
            break;
          }
        }
      }

      // If match found, return the coordinates
      if (match) {
        // console.log("match", {
        //   srcX,
        //   srcY,
        //   subWidth,
        //   subHeight,
        //   srcHeight,
        //   srcWidth,
        // });
        return {
          x: srcX,
          y: srcY,
          width: subWidth,
          height: subHeight,
        };
      }
    }
  }
  return null;
}
