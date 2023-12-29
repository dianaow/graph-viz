// Function to split long text into lines
export function splitLongText (text, maxLineLength) {
  const words = text ? text.split(' ') : []
  const lines = []
  let currentLine = ''

  words.forEach(function (word) {
    if (currentLine.length + word.length <= maxLineLength) {
      currentLine += word + ' '
    } else {
      lines.push(currentLine.trim())
      currentLine = word + ' '
    }
  })

  if (currentLine.trim() !== '') {
    lines.push(currentLine.trim())
  }

  return lines
}

export function getTextSize (text, fontSize, fontFamily) {
  // Create a temporary span element
  const span = document.createElement('span')
  span.textContent = text

  // Set the font for the text measurement
  span.style.fontSize = fontSize
  span.style.fontFamily = fontFamily

  // Append the span to the document body
  document.body.appendChild(span)

  // Measure the width and height of the text
  const width = span.offsetWidth
  const height = span.offsetHeight

  // Clean up the temporary span
  document.body.removeChild(span)

  return { width, height }
}
