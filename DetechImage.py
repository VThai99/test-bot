import cv2
import numpy as np
import json
import time
import argparse
import sys

def find_template_in_image(main_image_path, template_image_path, method=cv2.TM_CCOEFF_NORMED, threshold=0.8):
    """
    Find a template image within a main image and return the positions.
    
    Args:
        main_image_path (str): Path to the main image
        template_image_path (str): Path to the template image to find
        method (int): Template matching method (default: cv2.TM_CCOEFF_NORMED)
        threshold (float): Matching threshold (0.0 to 1.0)
        
    Returns:
        list: List of tuples containing (x, y, width, height) of matches
    """
    # Step 1: Load both images
    main_image = cv2.imread(main_image_path)
    template = cv2.imread(template_image_path)
    
    # Check if images loaded successfully
    if main_image is None:
        raise ValueError(f"Could not load main image from {main_image_path}")
    if template is None:
        raise ValueError(f"Could not load template image from {template_image_path}")
    
    # Convert to grayscale for better matching
    main_image_gray = cv2.cvtColor(main_image, cv2.COLOR_BGR2GRAY)
    template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    
    # Get template dimensions
    h, w = template_gray.shape
    
    # Step 2: Perform template matching
    result = cv2.matchTemplate(main_image_gray, template_gray, method)
    
    # Step 3: Find locations where matching exceeds threshold
    locations = []
    
    # For TM_CCOEFF_NORMED and TM_CCORR_NORMED, higher values mean better match
    if method in [cv2.TM_CCOEFF_NORMED, cv2.TM_CCORR_NORMED]:
        match_locations = np.where(result >= threshold)
    # For TM_SQDIFF and TM_SQDIFF_NORMED, lower values mean better match
    else:
        match_locations = np.where(result <= threshold)
    
    # Convert to (x, y, w, h) format and ensure standard Python integers (not NumPy types)
    for pt in zip(*match_locations[::-1]):  # Switch columns and rows
        locations.append((int(pt[0]), int(pt[1]), int(w), int(h)))
    
    # Step 4: Group overlapping rectangles if needed
    if len(locations) > 1:
        # Convert to format required by groupRectangles
        rect_list = [(x, y, x + w, y + h) for x, y, w, h in locations]
        
        try:
            # Group overlapping rectangles
            grouped_rects, _ = cv2.groupRectangles(rect_list, 1, 0.3)
            # Convert back to (x, y, w, h) format with standard Python integers
            locations = [(int(x), int(y), int(x2 - x), int(y2 - y)) for x, y, x2, y2 in grouped_rects]
        except:
            # If groupRectangles fails, keep original locations
            pass
    
    return locations

def analyze_image(main_image_path, template_image_path, template_threshold=0.8):
    """
    Analyze image for template matches and return simplified position information.
    
    Args:
        main_image_path (str): Path to the main image
        template_image_path (str): Path to the template image
        template_threshold (float): Threshold for template matching
        
    Returns:
        dict: Dictionary with match status and position
    """
    # Perform template matching
    try:
        locations = find_template_in_image(
            main_image_path, 
            template_image_path, 
            threshold=template_threshold
        )
        
        # Return first match if found
        if locations:
            x, y, width, height = locations[0]
            return {
                "match": True,
                "position": {
                    "x": int(x),
                    "y": int(y),
                    "width": int(width),
                    "height": int(height)
                }
            }
        else:
            return {
                "match": False,
                "position": {
                    "x": 0,
                    "y": 0,
                    "width": 0,
                    "height": 0
                }
            }
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return {
            "match": False,
            "position": {
                "x": 0,
                "y": 0,
                "width": 0,
                "height": 0
            }
        }

# Command line interface
if __name__ == "__main__":
    # Set up command line argument parser
    parser = argparse.ArgumentParser(description='Find template image within a main image.')
    parser.add_argument('main_image', help='Path to the main image')
    parser.add_argument('template_image', help='Path to the template image to find')
    parser.add_argument('--threshold', '-t', type=float, default=0.7,
                        help='Matching threshold (0.0 to 1.0, default: 0.7)')
    
    # Parse arguments
    args = parser.parse_args()
    
    # Find template matches
    result = analyze_image(
        args.main_image,
        args.template_image,
        template_threshold=args.threshold
    )
    
    # Output only the JSON result in the requested format
    print(json.dumps(result))