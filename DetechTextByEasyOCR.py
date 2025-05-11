import easyocr
import json
import numpy as np
import argparse
from PIL import Image
import cv2
import os

def detect_text(image_path, output_path=None, languages=['en']):
    """
    Detect text in an image and return the text and its position.
    
    Args:
        image_path (str): Path to the input image
        output_path (str, optional): Path to save the JSON output. If None, don't save to file.
        languages (list, optional): List of language codes. Default is ['en'] for English.
            
    Returns:
        dict: JSON-serializable dictionary containing detected text and positions
    """
    # Initialize EasyOCR reader
    reader = easyocr.Reader(languages)
    
    # Read image and detect text
    result = reader.readtext(image_path)
    
    # Format the results
    text_data = []
    for detection in result:
        bbox = detection[0]  # List of 4 points (x,y coordinates of the bounding box)
        text = detection[1]  # Detected text
        confidence = float(detection[2])  # Confidence score
        
        # Calculate bounding box properties
        x_values = [point[0] for point in bbox]
        y_values = [point[1] for point in bbox]
        
        x_min, x_max = min(x_values), max(x_values)
        y_min, y_max = min(y_values), max(y_values)
        
        # Format the entry exactly as requested
        text_entry = {
            "text": text,
            "rect": {
                "x": float(x_min),
                "y": float(y_min),
                "width": float(x_max - x_min),
                "height": float(y_max - y_min)
            }
        }
        text_data.append(text_entry)
    
    # Create the result object with the requested format
    result_json = {
        "image_path": image_path,
        "items": text_data
    }
    
    # Save to file if output path is provided
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result_json, f, indent=4, ensure_ascii=False)
        print(f"Results saved to {output_path}")
    
    return result_json

def visualize_detections(image_path, detections_json, output_path=None):
    """
    Visualize text detections on the image
    
    Args:
        image_path (str): Path to the input image
        detections_json (dict): JSON data with text detections
        output_path (str, optional): Path to save the visualized image. If None, don't save.
        
    Returns:
        numpy.ndarray: Image with visualized detections
    """
    # Read the image
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image from {image_path}")
    
    # Draw bounding boxes and text
    for item in detections_json["items"]:
        # Get the bounding box
        rect = item["rect"]
        x, y = int(rect["x"]), int(rect["y"])
        width, height = int(rect["width"]), int(rect["height"])
        
        # Draw the rectangle
        cv2.rectangle(image, (x, y), (x + width, y + height), (0, 255, 0), 2)
        
        # Add text
        text = item["text"]
        cv2.putText(image, text, 
                    (x, y - 10), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    # Save the image if output path is provided
    if output_path:
        cv2.imwrite(output_path, image)
        print(f"Visualization saved to {output_path}")
    
    return image

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Detect text in images using EasyOCR')
    parser.add_argument('image_path', help='Path to the input image')
    parser.add_argument('--output', '-o', help='Path to save the JSON output', default=None)
    parser.add_argument('--languages', '-l', nargs='+', help='Languages to detect', default=['en'])
    parser.add_argument('--visualize', '-v', action='store_true', help='Visualize the detections')
    parser.add_argument('--vis_output', help='Path to save the visualization', default=None)
    
    args = parser.parse_args()
    
    # Run text detection
    result = detect_text(args.image_path, args.output, args.languages)
    
    # Print results if not saving to file
    if not args.output:
        print(json.dumps(result, indent=4, ensure_ascii=False))
    
    # Visualize if requested
    if args.visualize:
        vis_output = args.vis_output or "visualization.jpg" if args.output else None
        visualize_detections(args.image_path, result, vis_output)