param (
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,
    
    [Parameter(Mandatory = $false)]
    [int]$MinimumConfidence = 60,
    
    [Parameter(Mandatory = $false)]
    [int]$MinimumLength = 2
)

# Define the path to Tesseract executable
$TesseractPath = "D:\tesseract\tesseract.exe"

# Check if the image file exists
if (-not (Test-Path $ImagePath)) {
    Write-Error "Image file not found: $ImagePath"
    exit 1
}

# Check if Tesseract exists
if (-not (Test-Path $TesseractPath)) {
    Write-Error "Tesseract executable not found at: $TesseractPath"
    exit 1
}

# Create a temporary directory for output files
$TempDir = Join-Path $env:TEMP "TesseractTemp"
if (-not (Test-Path $TempDir)) {
    New-Item -ItemType Directory -Path $TempDir | Out-Null
}

# Generate a unique filename for temporary files
$TempBaseName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetRandomFileName())
$TempOutputBasePath = Join-Path $TempDir $TempBaseName

try {
    # Run Tesseract with HOCR output format (HTML with position information)
    $HocrOutputPath = "$TempOutputBasePath.hocr"
    $Process = Start-Process -FilePath $TesseractPath -ArgumentList "`"$ImagePath`" `"$TempOutputBasePath`" -l eng hocr" -PassThru -NoNewWindow -Wait
    
    if ($Process.ExitCode -ne 0) {
        Write-Error "Tesseract process failed with exit code: $($Process.ExitCode)"
        exit 1
    }

    # Check if HOCR file was created
    if (-not (Test-Path "$HocrOutputPath")) {
        Write-Error "Tesseract failed to create output file."
        exit 1
    }

    # Load the HOCR content
    [xml]$HocrContent = Get-Content -Path "$HocrOutputPath" -Raw

    # Define namespace manager for XPath queries
    $NamespaceManager = New-Object System.Xml.XmlNamespaceManager($HocrContent.NameTable)
    $NamespaceManager.AddNamespace("html", "http://www.w3.org/1999/xhtml")

    # Extract text and position data
    $TextElements = $HocrContent.SelectNodes("//html:span[contains(@class, 'ocrx_word')]", $NamespaceManager)

    # Define a function to check if a word is meaningful
    function Is-MeaningfulWord {
        param([string]$Word)
        
        # Word has at least MinimumLength characters
        if ($Word.Length -lt $MinimumLength) {
            return $false
        }
        
        # List of common stop words to filter out
        $StopWords = @(
            "a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "in",
            "of", "as", "is", "am", "are", "was", "were", "be", "been", "being",
            "it", "its", "it's", "this", "that", "these", "those", "he", "she", "they", "we",
            "i", "me", "my", "mine", "his", "her", "hers", "their", "theirs", "our", "ours"
        )
        
        # Check if the word is a stop word (case insensitive)
        if ($StopWords -contains $Word.ToLower()) {
            return $false
        }
        
        # Check if the word contains at least one alphanumeric character
        if (-not ($Word -match "[a-zA-Z0-9]")) {
            return $false
        }
        
        return $true
    }

    # Create an array to hold the results
    $Results = @()

    foreach ($Element in $TextElements) {
        $Text = $Element.InnerText.Trim()
        
        if (-not [string]::IsNullOrWhiteSpace($Text)) {
            # Extract confidence if available
            $Confidence = if ($TitleAttr -match "x_wconf (\d+)") { [int]$Matches[1] } else { 100 }
            
            # Check if the word is meaningful and meets minimum confidence
            if (Is-MeaningfulWord -Word $Text -and $Confidence -ge $MinimumConfidence) {
                # Extract bounding box information
                $TitleAttr = $Element.GetAttribute("title")
                
                if ($TitleAttr -match "bbox (\d+) (\d+) (\d+) (\d+)") {
                    $X1 = [int]$Matches[1]
                    $Y1 = [int]$Matches[2]
                    $X2 = [int]$Matches[3]
                    $Y2 = [int]$Matches[4]
                    
                    # Calculate width and height
                    $Width = $X2 - $X1
                    $Height = $Y2 - $Y1
                    
                    # Add to results
                    $Results += [PSCustomObject]@{
                        Text = $Text
                        Position = [PSCustomObject]@{
                            X = $X1
                            Y = $Y1
                            Width = $Width
                            Height = $Height
                        }
                        Confidence = if ($TitleAttr -match "x_wconf (\d+)") { [int]$Matches[1] } else { $null }
                    }
                }
            }
        }
    }

    # Convert to JSON and output
    $JsonOutput = $Results | ConvertTo-Json -Depth 3
    Write-Output $JsonOutput

} catch {
    Write-Error "Error processing image: $_"
    exit 1
} finally {
    # Clean up temporary files
    if (Test-Path "$TempOutputBasePath.hocr") {
        Remove-Item "$TempOutputBasePath.hocr" -Force
    }
}