import * as d3 from 'd3'
import { bfsFromNode } from 'graphology-traversal'
import { dijkstra } from 'graphology-shortest-path'
import Graph from 'graphology'
import { generateArc, generatePath } from './pathUtils.js'
import { findParent, splitLongText, getTextSize, getNodeColor, setNodeColor, getRootNodes, mixColors, hslToRgb, forceCollide  } from './utils.js'

const defaultContainerStyles = {
  'background-color': '#15181F',
  color: '#ffffff',
  'font-family': 'sans-serif'
}

const defaultLabelStyles = {
  fontWeight: 'normal',
  visibility: 'hidden',
  color: '#ffffff',
  label: '',
  edge: {
    visibility: 'hidden',
    opacity: 0.4,
    'font-size': '6px',
    label: ''
  }
}

const defaultNodeStyles = {
  fill: '#ffffff', // node color (only applied if specified)
  // stroke : '#000000', // node stroke color (only applied if specified)
  strokeWidth: 1, // node stroke width, in pixels
  fillOpacity: 0.8, // node stroke opacity
  strokeOpacity: 1, // node stroke opacity
  type: 'standard' // gradient/standard/filled
}

const defaultLinkStyles = {
  // stroke : '#ffffff', // link stroke color (only applied if specified, if not it will follow the source node color)
  strokeOpacity: 0.7, // link stroke opacity
  strokeWidth: 2, // given d in links, returns a stroke width in pixels
  type: 'line' // arc/line
}

export default function ForceGraph (
  {
    nodes, // an iterable of node objects (typically [{id}, …])
    links // an iterable of link objects (typically [{source, target}, …])
  },
  {
    containerSelector,
    nodeId = 'id', // given d in nodes, returns a unique identifier (string)
    sourceId = 'source',
    targetId = 'target',
    nodeGroup, // key in data representing a node group
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    nodeStyles = defaultNodeStyles,
    linkStyles = defaultLinkStyles,
    labelStyles = defaultLabelStyles,
    containerStyles = defaultContainerStyles,
    tooltip = {
      styles: {
        display: 'block',
        position: 'absolute',
        width: 'auto',
        height: 'auto',
        padding: '8px',
        'background-color': '#ffffff',
        color: '#000000',
        border: '1px solid #ddd',
        'z-index': 10
      },
      custom: function (tooltipEl, d) {
        const tooltip = tooltipEl.node()
      }
    },
    preventLabelCollision = false
  } = {}
) {
  // Merge default and user given styles
  containerStyles = { ...defaultContainerStyles, ...containerStyles }
  labelStyles = { ...defaultLabelStyles, ...labelStyles }
  linkStyles = { ...defaultLinkStyles, ...linkStyles }
  nodeStyles = { ...defaultNodeStyles, ...nodeStyles }
  labelStyles.edge = { ...defaultLabelStyles.edge, ...labelStyles.edge }

  if (containerStyles.theme === 'dark') {
    containerStyles['background-color'] = '#15181F'
    containerStyles.color = '#ffffff'
    labelStyles.color = containerStyles.color
  } else if (containerStyles.theme === 'light') {
    containerStyles['background-color'] = '#ffffff'
    containerStyles.color = '#000000'
    labelStyles.color = containerStyles.color
  }
  if (!containerStyles['font-family']) containerStyles['font-family'] = 'Courier'

  // Initial states
  const visited = new Set();
  const maxLineLength = 22
  const showEle = {}
  const nodeDegrees = {} // an object to store each node degree (number of connections that a node has to other nodes in the network)
  let singleNodeIDs = [] // an array to store the names of nodes with no connections to other nodes

  // Click helper states
  let clickedNodes = [] // an array to store the names of clicked nodes
  let clickCount = 0
  let timer

  // View states
  let searched = false // if node is searched for from the searchbox or tree, searched=true
  let clickedSP = false // if two nodes are clicked to reveal the shortest path (SP) results between them, clickedSP=true
  let clickedNN = false // if a node has been clicked to reveal its nearest neighbor (NN), clickedNN=true

  // Button activation states
  // Note: there are different consequences for a VIEW state and BUTTON ACTIVATION state, so these variables are separated)
  let showArrows = true // if edge directions are shown on graph, showArrows=true
  let showNeighbors = false // if user is allowed to mouseover node to begin search for OUTWARD-BOUND ONLY neighbours 2 degrees away, showNeighours=true
  let showShortestPath = false // if user is allowed to click on any node to begin SP search, showShortestPath = true (this flag helps to differentiate from click-to-drag event)
  let showSingleNodes = true // to show/hide on screen nodes with no connections

  const ele = uniqueElements(nodes, links)

  ele.nodes.forEach(d => {
    d.parent = findParent(links, d.entity)
    d.linkCnt = d.type === 'sub' ? 0 : countConnections(links, d.entity);
    //d.root = d.entity === 'sustainable energy' ? true : false
  })

  // Set up accessors to enable a cleaner way of accessing data attributes
  const N = d3.map(ele.nodes, (d) => d[nodeId]).map(intern)
  const LS = d3.map(ele.links, (d) => d[sourceId]).map(intern)
  const LT = d3.map(ele.links, (d) => d[targetId]).map(intern)

  // Replace the input nodes and links with mutable objects for the simulation
  showEle.nodes = d3.map(ele.nodes, (d, i) => ({
    id: N[i],
    ...d
  }))
  showEle.links = d3.map(ele.links, (d, i) => ({
    source: LS[i],
    target: LT[i],
    ...d
  }))

  // To calculate number of incoming connections to size node radius
  showEle.nodes.forEach((node) => {
    nodeDegrees[node.id] = 0
  })

  // Sizes of the nodes weighted by the number of links going into and out of that node
  showEle.links.forEach((link) => {
    nodeDegrees[link.source]++
    nodeDegrees[link.target]++
    nodeDegrees[link.Subject]++
  })

  const graph = initGraphologyGraph(showEle.nodes, showEle.links);

  const nodeRadiusScale = d3
    .scaleSqrt()
    //.domain([0, d3.max(Object.values(nodeDegrees))])
    .domain([0, d3.max(showEle.nodes, d => d.linkCnt)])
    .range([4, 40])
    .clamp(true)

  const linkWidthScale = d3
    .scaleSqrt()
    .domain(d3.extent(showEle.links, (d) => d[linkStyles.strokeWidth] || 1))
    .range([1, 3])
    .clamp(true)

  const colors = ["#418BFC", "#46BCC8", "#EB5E68", "#B6BE1C", "#F64D1A", "#BA6DE4", "orange", "#ffffff"]
  //const categories = [...new Set(showEle.nodes.map((d) => d[nodeGroup]))]
  
  // only assign colors to the top 7 categories with the most nodes
  const groupedData = d3.rollup(showEle.nodes, v => v.length, d => d[nodeGroup])
  const groupedData1 = Array.from(groupedData, ([key, value]) => ({ key, value }));
  groupedData1.sort((a, b) => d3.descending(a.value, b.value))
  const categories = groupedData1.map(d => d.key).slice(0, colors.length - 1)

  // Generate rainbow colors and print RGB codes
  const hubs = Array.from(new Set(links.map(d => d.parent)))
  //const hubs = Object.keys(links)
  const rainbowColors = [];
  const numberOfColors = hubs.length;

  for (let i = 0; i < numberOfColors; i++) {
      const hue = i / numberOfColors;
      const [r, g, b] = hslToRgb(hue, 1, 0.5);
      rainbowColors.push([r, g, b]);
  }

  const colorScale = d3.scaleOrdinal()
    .domain(hubs)
    .range(rainbowColors)

  /// ///////////////// Set up initial  DOM elements on screen ///////////////////
  const container = d3.select(containerSelector)

  for (const prop in containerStyles) {
    container.style(prop, containerStyles[prop])
  }

  // Create a container for tooltip that is only visible on mouseover of a node
  const tooltipDiv = container.append('div').attr('class', 'tooltip').style('visibility', 'hidden')

  for (const prop in tooltip.styles) {
    tooltipDiv.style(prop, tooltip.styles[prop])
  }

  // Create a container to show / track clicked node selection to find shortest path
  const message = container.append('div').attr('class', 'message').style('position', 'absolute').style('top', '90px').style('left', '50%').style('transform', 'translate(-50%, -50%)').style('text-align', 'center').style('visibility', 'hidden')

  message.append('div').attr('class', 'clickedNodes-1').style('padding', '2px').style('font-size', '14px')

  message.append('div').attr('class', 'clickedNodes-2').style('padding', '2px').style('font-size', '14px')

  message.append('div').attr('class', 'shortestPath-status').style('padding', '2px').style('font-size', '12px')

  message
    .append('div')
    .attr('class', 'clickedNodes-reset')
    .style('text-decoration', 'underline')
    .style('pointer-events', 'auto')
    .style('cursor', 'pointer')
    .html('RESET')
    .on('click', function () {
      reset()
    })

  // Create a container for the graph
  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [-width / 2, -height / 2, width, height])
    .attr('style', 'max-width: 100%; height: auto; pointer-events: auto;')

  // Create and store arrowheads that will be used when the lines are rendered later
  svg.append('defs').append('marker').attr('id', 'arrowhead').attr('viewBox', '-0 -6 12 12').attr('refX', 0).attr('refY', 0).attr('orient', 'auto').attr('markerWidth', 6).attr('markerHeight', 6).attr('xoverflow', 'visible').append('svg:path').attr('d', 'M 0,-6 L 12 ,0 L 0,6').attr('fill', linkStyles.stroke).style('stroke', 'none')

  colors.forEach((color) => {
    if (!linkStyles.stroke) {
      svg
        .append('defs')
        .append('marker')
        .attr('id', 'arrowhead-' + color)
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 0)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 5)
        .attr('markerHeight', 5)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
        .attr('fill', color)
        .style('stroke', 'none')
    }

    if (nodeStyles.type === 'gradient') {
      const radialGradient = svg
        .append('defs')
        .append('radialGradient')
        .attr('id', 'radial-gradient-' + color)
        .attr('cx', '50%') // The x-center of the gradient
        .attr('cy', '50%') // The y-center of the gradient
        .attr('r', '50%') // The radius of the gradient

      // Add colors to make the gradient give a faux 3d effect
      radialGradient.append('stop').attr('offset', '0%').attr('stop-color', color)

      radialGradient.append('stop').attr('offset', '90%').attr('stop-color', containerStyles['background-color'])
    }
  })

  // Create clip-path for image icons
  // svg.append('defs').selectAll('clipPath').data(showEle.nodes).join('clipPath').attr('id', (d) => d.id + '-clip').append('circle').attr('r', (d) => d.radius);

  const g = svg.append('g').attr('class', 'main-group')

  const linkG = g.append('g').attr('class', 'links')
  const linkTextG = g.append('g').attr('class', 'linkTexts')
  const nodeG = g.append('g').attr('class', 'nodes')
  const textG = g.append('g').attr('class', 'labels')
  /// ////////////////////////////////////////////////////////////////////////////

  /// /////////////////////////// Create a legend ////////////////////////////////
  const legendWidth = 350
  const legendHeight = Math.max(130, categories.length * 30)
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', (d, i) => `translate(${width / 2 - legendWidth}, ${height / 2 - legendHeight - 100})`)

  legend.append('rect').attr('fill', containerStyles.color).attr('x', -20).attr('y', -20).attr('fill', containerStyles['background-color']).attr('stroke', containerStyles.color).attr('width', legendWidth).attr('height', legendHeight)

  legend.append('rect').attr('fill', containerStyles.color).attr('x', -20).attr('y', -20).attr('fill', containerStyles.color).attr('stroke', containerStyles['background-color']).attr('width', 80).attr('height', 30)

  legend.append('text').attr('x', -10).attr('y', 0).attr('fill', containerStyles['background-color']).text('LEGEND')

  const legendRadius = legend
    .selectAll('.legendCircle')
    .data(nodeRadiusScale.range())
    .enter()
    .append('g')
    .attr('class', 'legendCircle')
    .attr('transform', (d, i) => `translate(170, ${d + 40})`)

  legendRadius
    .append('circle')
    .attr('r', (d) => d)
    .style('stroke', containerStyles.color)
    .style('fill', 'none')

  legendRadius
    .append('text')
    .attr('x', 30)
    .attr('y', (d) => d)
    .attr('fill', containerStyles.color)
    .text((d) => d)

  legend.append('text').attr('x', 150).attr('y', 25).attr('font-size', '10px').attr('fill', containerStyles.color).text('Number of connections')

  // const legendItems = legend
  //   .selectAll('.legend-item')
  //   .data(categories)
  //   .enter()
  //   .append('g')
  //   .attr('class', 'legend-item')
  //   .attr('transform', (d, i) => `translate(0, ${(i + 1) * 20})`)

  // legendItems
  //   .append('rect')
  //   .attr('width', 15)
  //   .attr('height', 15)
  //   .attr('fill', (d) => colorScale(d))

  // legendItems
  //   .append('text')
  //   .attr('x', 25)
  //   .attr('y', 8)
  //   .attr('alignment-baseline', 'middle')
  //   .text((d, i) => d)
  //   .style('font-size', '12px')
  //   .style('fill', containerStyles.color)

  /// ////////////////////////////////////////////////////////////////////////////

  /// ///////////////////////// add zoom capabilities ////////////////////////////
  const zoomHandler = d3.zoom().on('zoom', function (event) {
    g.attr('transform', event.transform)
    if (event.transform.k >= 3) {
      svg.selectAll('textPath').attr("visibility", 'visible');
    } else {
      svg.selectAll('textPath').attr('visibility', labelStyles.edge.visibility);
    }
    // if (clicked || searched) return;
    // zoomLevel = event.transform.k;
    // if (zoomLevel >= 3.5) {
    //   svg.selectAll(".label").attr("visibility", (d) => (d.linkCnt >= 10 ? "visible" : "hidden"));
    // } else if (zoomLevel >= 2) {
    //   svg.selectAll(".label").attr("visibility", (d) => (d.linkCnt >= 20 ? "visible" : "hidden"));
    // } else if (zoomLevel < 2) {
    //   svg.selectAll(".label").attr("visibility", labelVisibility);
    // }
  })

  svg.call(zoomHandler)
  ////////////////////////////////////////////////////////////////////////////////

  ///////////////////////// SIMULATION-RELATED FUNCTIONS /////////////////////////
  const simulation = d3.forceSimulation()
  .force(
    'link',
    d3
      .forceLink()
      .id((d) => d.id)
      //.distance((d) => {
        //return d.source.id === 'sutainable energy' ? 75 : 55
      //})
  )
  .force(
    'x',
    d3.forceX((d) => d.x)
  )
  .force(
    'y',
    d3.forceY((d) => d.y)
  )
  // .force("charge", d3.forceManyBody().strength(Math.max(-200, -10000 / showEle.nodes.length)))
  .force('charge', d3.forceManyBody().strength(-250))
  //.force('cluster', forceCluster().strength(0.15))

  if(preventLabelCollision) {
    simulation.force('collide', forceCollide())
  } else {
    simulation
      .force(
        'collide',
        d3
          .forceCollide()
          .radius((d) => d.radius)
          .iterations(3)
      )
  }

  //updateAttributes(showEle.nodes, showEle.links)
  //updateLayout()

  function uniqueElements(nodes, links) {
    // May not be needed in future: Check for duplicate nodes and links, particularly so since we are constructing the graph only based on relations data
    const uniqueNodes = nodes.reduce((acc, node) => {
      // Check if a node with the same 'entity' already exists in the accumulator
      const existingNode = acc.find((n) => n[nodeId] === node[nodeId]);
      // If not found, add the current node to the accumulator
      if (!existingNode) {
        acc.push(node);
      } 
      return acc;
    }, []);

    const uniqueLinks = links.reduce((acc, link) => {
      // Check if a link with the same 'Subject' and 'Object' already exists in the accumulator
      const existingLink = acc.find(
        (l) => l[sourceId] === link[sourceId] && l[targetId] === link[targetId]
      );
      // If not found, add the current link to the accumulator
      if (!existingLink) {
        acc.push(link);
      }
      return acc;
    }, []);

    return {nodes: uniqueNodes, links:uniqueLinks}
  }

  function updateAttributes(nodes, links) {
    nodes.forEach((n, i) => {
      //n.linkCnt = nodeDegrees[n.id] || 0
      const radius = nodeRadiusScale(n.linkCnt)
      const substrings = splitLongText(n.id, maxLineLength)
  
      const texts = []
      substrings.forEach((string) => {
        const text = getTextSize(string, Math.max(8, radius) + 'px', containerStyles['font-family'])
        texts.push({ text: string, width: text.width, height: text.height })
      })

      n.width = d3.max(texts, (d) => d.width) + radius * 2
      n.height = d3.max(texts, (d) => d.height) * substrings.length + radius
      n.radius = radius
      n.color = hubs.indexOf(n.id) === -1 ? colorScale(n.parent[n.parent.length - 1]) : (n.root ? [255, 255, 255] : colorScale(n.id) )
    })
  
    links.forEach((l, i) => {
      if (typeof linkStyles.strokeWidth === 'string' && !linkStyles.strokeWidth.includes('px')) {
        const W = d3.map(showEle.links, (d) => d[linkStyles.strokeWidth])
        l.strokeWidth = linkWidthScale(W[i]) || 1
      } else {
        l.strokeWidth = linkStyles.strokeWidth
      }
    })
  }

  function updateLayout () {
    // PRECAUTIONARY ACTION: REMOVE DUPLICATE LINKS
    const uniqueLinks = []
    const uniqueLinksSet = new Set()
    showEle.links.forEach((link, i) => {
      if (Object.keys(link).length === 0) return
      const sourceID = link.source.id ? link.source.id : link.source
      const targetID = link.target.id ? link.target.id : link.target
      const linkStr = `${sourceID}-${targetID}`
      if (!uniqueLinksSet.has(linkStr)) {
        uniqueLinksSet.add(linkStr)
        uniqueLinks.push(link)
      }
    })
    showEle.links = uniqueLinks

    const graph = initGraphologyGraph(showEle.nodes, showEle.links)
    
    colorNodes(graph, showEle.nodes);

    const clickNodeForShortestPath = (dd) => {
      if (clickedNodes.length < 2) {
        if (clickedNodes.indexOf(dd.id) === -1) {
          // if the same node is not already clicked, add to array
          clickedNodes.push(dd.id)
        } else {
          clickedNodes.splice(dd.id, 1) // remove a clicked node if the same node is clicked again
        }
      }
      clickedNodesFeedback(clickedNodes) // render clicked node(s) name on screen to let the user know they have engaged with the circle
      // Only proceed with finding shortest path between 2 different clicked nodes
      if (clickedNodes.length === 2) {
        const connectedNodes = findShortestPath(graph, clickedNodes)
        clickedSP = true // Flag to prevent any action that should not happen during shortest path view
        if (connectedNodes) {
          console.log('highlight connections')
          // Only proceed with showing the nodes and paths that constitute the shortest path if it exist
          highlightConnections(connectedNodes)
        } else {
          // Provide feedback to user that no shortest path exist between the 2 nodes
          d3.select('.shortestPath-status').html('No shortest path found. Would you like to try again?')
        }
        // disable tree interaction to prevent interference with current shortest path view
        document.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => (checkbox.disabled = true))
      }
    }

    const clickNodeForNearestNeighbor = (event, dd) => {
      updateTooltip(event, dd) // show tooltip on mouseover any node

      const connectedNodes = findNeighbours(graph, [dd])
      if (connectedNodes) highlightConnections(connectedNodes)
      message.style('visibility', 'visible') // Show RESET message
      clickedNN = true
    }

    simulation.nodes(showEle.nodes).force('link').links(showEle.links)

    simulation.alphaTarget(0.1).restart() // increase alphaDecay value to cool down a graph more quickly

    //simulation.tick(Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())))
    simulation.on('tick', ticked)

    // // Calculate cluster dimensions
    // const clusters = d3.groups(showEle.nodes, (d) => d[nodeGroup])
    // const clusterBoxes = []
    // clusters.forEach((c) => {
    //   const textDimensions = getTextSize(c[0], '14px', containerStyles['font-family'])
    //   const radius = d3.max(c[1].map((d) => d.radius))
    //   const padding = 10
    //   const minX = d3.min(c[1].map((d) => d.x)) - radius - padding
    //   const maxX = d3.max(c[1].map((d) => d.x)) + radius + padding
    //   const minY = d3.min(c[1].map((d) => d.y)) - radius - padding
    //   const maxY = d3.max(c[1].map((d) => d.y)) + radius + padding
    //   clusterBoxes.push({ minX, maxX, minY, maxY, cluster: c[0], textW: textDimensions.width + 5, textH: textDimensions.height + 5 })
    // })

    // // Update existing cluster rectangles
    // const updatedClusters = nodeG.selectAll('.cluster').data(clusterBoxes, (d) => d.cluster)

    // updatedClusters.join(
    //   (enter) => {
    //     const newCluster = enter
    //       .append('g')
    //       .attr('class', 'cluster')
    //       .attr('opacity', 1)
    //       .attr('transform', (d) => `translate(${d.minX}, ${d.minY})`)
    //       .attr('visibility', 'visible')

    //     newCluster
    //       .append('rect')
    //       .attr('fill', 'none')
    //       .attr('stroke', (d) => colorScale(d.cluster))
    //       .attr('stroke-width', '1px')
    //       .attr('width', (d) => d.maxX - d.minX)
    //       .attr('height', (d) => d.maxY - d.minY)

    //     newCluster
    //       .append('rect')
    //       .attr('y', (d) => -d.textH)
    //       .attr('fill', (d) => colorScale(d.cluster))
    //       .attr('stroke', (d) => colorScale(d.cluster))
    //       .attr('width', (d) => d.textW)
    //       .attr('height', (d) => d.textH)

    //     newCluster
    //       .append('text')
    //       .attr('x', 3)
    //       .attr('y', -6)
    //       .attr('font-size', '14px')
    //       .attr('fill', 'white')
    //       .text((d) => d.cluster.toUpperCase())

    //     return newCluster
    //   },
    //   (update) => update,
    //   (exit) => exit.remove()
    // )

    const enterFunc = enter => enter.transition().delay(550).duration(1000).attr("opacity", 1)
    
    const updateFunc = update => {
      if (update.size() > 0) {
        // Apply the force
        simulation.force('charge', d3.forceManyBody().strength(-1550));
      }   
    }
    
    const exitFunc = exit => {
      return exit.transition() // apply transition
          .duration(500)
          // .on("start", () => {
          //   // After the second transition, adjust the force strength again
          //   simulation.force('charge').strength(-1550);
          // })
          .attr("opacity", 0) // fade out
          .remove() // remove from DOM
          .end().then(() => {
              // Remove the force after the transition ends
              simulation.force('charge', d3.forceManyBody().strength(-250));
          });
    }

    // Update existing links
    const link = linkG
      .selectAll('path.link')
      .data(showEle.links, (d) => d.source.id + '_' + d.target.id)
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'link')
            .attr('id', (d) => d.source.id + '_' + d.target.id)
            .attr('stroke', (d) => {
              const node = showEle.nodes.find(el => el.id === d.target.id) 
              return linkStyles.stroke || `rgb(${node.color[0]}, ${node.color[1]}, ${node.color[2]})`
            })
            .attr('stroke-width', (d) => d.strokeWidth)
            .attr('d', (d) => (linkStyles.type === 'arc' ? generateArc(d, 1, true) : generatePath(d, true)))      
            .on('mouseover', function (event, dd) {
              updateLinkTooltip(event, dd) // show tooltip on mouseover any link
            })
            .on('mouseleave', function () {
              tooltipDiv.style('visibility', 'hidden')
            })
            .attr('opacity', 0)
            .call(enter => enter.transition().delay(550).duration(1000).attr("opacity", linkStyles.strokeOpacity)),

        update => update.call(updateFunc),
        exit => exit.call(exitFunc)
      )
      .attr('pointer-events', 'auto')
      .attr('cursor', 'pointer')
      .attr('fill', 'none')

    if (showArrows) {
      if (!linkStyles.stroke) {
        linkG.selectAll('path.link').attr('marker-end', (d) => `url(#arrowhead-${d.source.color})`) // render arrow heads in the middle of line
      } else {
        linkG.selectAll('path.link').attr('marker-end', 'url(#arrowhead)')
      }
    }

    // Update existing link labels
    const linkTexts = linkTextG
      .selectAll('text.link')
      .data(showEle.links, (d) => d.source.id + '_' + d.target.id)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('class', 'link')
            // .attr('x', (d) => (d.target.x - d.source.x) / 2 + d.source.x + 10)
            // .attr('y', (d) => (d.target.y - d.source.y) / 2 + d.source.y)
            .attr('dy', -3)
            .attr('opacity', 0)
            .call(enterFunc)
            .append('textPath')
            .attr('visibility', labelStyles.edge.visibility)
            .attr('xlink:href', (d, i) => '#' + d.source.id + '_' + d.target.id)
            .attr('startOffset', '50%')
            .attr('text-anchor', 'middle')
            .text((d) => d[labelStyles.edge.label]),

        update => update.call(updateFunc),
        exit => exit.call(exitFunc)
      )
      .attr('opacity', labelStyles.edge.opacity)
      .attr('fill', labelStyles.edge.color || labelStyles.color)
      .attr('font-size', labelStyles.edge['font-size'])

    // Update existing nodes
    const updatedNode = nodeG.selectAll('.node').data(showEle.nodes, (d) => d.id)

    updatedNode.join(
      (enter) => {
        const newNode = enter
          .append('g')
          .attr('class', 'node')
          .attr('pointer-events', 'auto')
          .attr('cursor', 'pointer')
          .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
          .call(drag(simulation))
          .on('click', function (event, dd) {
            event.preventDefault()
            if (searched) return
            clickCount++
            if (clickCount === 1) {
              // Different types of click actions based on button activated
              if (showShortestPath) {
                timer = setTimeout(function () {
                  clickNodeForShortestPath(dd)
                  clickCount = 0
                }, 300)
              } else if (showNeighbors) {
                timer = setTimeout(function () {
                  clickNodeForNearestNeighbor(event, dd)
                  clickCount = 0
                }, 300)
              } else {
                // reset the clickCount if the time between first and second click exceeds 300ms.
                timer = setTimeout(function () {
                  clickCount = 0
                }, 300)
              }
              // disable expand/collapse feature if either nearest neighbour or shortest path button is activated
            } else if (clickCount === 2 && !showShortestPath && !showNeighbors) {
              clearTimeout(timer)
              clickCount = 0
            }
          })
          .attr('opacity', 0)
          .call(enterFunc)
          .on('dblclick.zoom', null)
            
        newNode
          .append('circle')
          .attr('r', (d) => d.radius)
          .attr('fill', (d) => (nodeStyles.type === 'gradient' ? `url('#radial-gradient-${d.color}')` : (d.root ? `rgb(255,255,255)` : `rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`)))
          .attr('stroke', (d) => nodeStyles.stroke || (d.root ? `rgb(255,255,255)` : `rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`))
          .attr('fill-opacity', nodeStyles.fillOpacity)
          .attr('stroke-opacity', nodeStyles.type === 'filled' ? nodeStyles.fillOpacity : nodeStyles.strokeOpacity)
          .attr('stroke-width', nodeStyles.type === 'gradient' ? '0.5px' : nodeStyles.strokeWidth) // it's nicer to have a thin circle stroke for nodes with radial gradient stroke

        // add icon
        // newNode
        //   .append('image')
        //   .attr('href', '')
        //   .attr('clip-path', (d) => `url(#${d.id}-clip)`)
        //   .attr('width', (d) => d.radius)
        //   .attr('height', (d) => d.radius)
        //   .attr('x', (d) => (d.radius / 2) * -1)
        //   .attr('y', (d) => (d.radius / 2) * -1);

        // debug view
        // newNode
        //   .append('rect')
        //   .attr('fill', 'white')
        //   .attr('x', (d) => -d.radius)
        //   .attr('y', (d) => -d.radius)
        //   .attr('width', (d) => d.width)
        //   .attr('height', (d) => d.height)

        return newNode
      },
      (update) => update.call(updateFunc),
      exit => exit.call(exitFunc)
    )
      
    // Update existing node labels
    const updatedText = textG.selectAll('.label').data(showEle.nodes, (d) => d.id)

    updatedText.join(
      (enter) => {
        const newText = enter
          .append('g')
          .attr('class', (d) => 'label label-' + d.id.replaceAll(' ', '-'))
          .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
          .attr('visibility', (d) => d.type === 'main' ? labelStyles.visibility : 'hidden')
          .attr('opacity', 0)
          .call(enterFunc)

        // if(labelBorder){
        // newText
        // .append('rect')
        // .attr('fill', containerStyles['background-color'])
        // .attr('stroke', labelStyles.color || containerStyles['color'])
        // .attr('x',(d) => d.radius + 2)
        // .attr('y',(d) => -d.radius - 2)
        // .attr('width', (d) => d.width - d.radius + 2)
        // .attr('height', (d) => d.height - 2)
        // }

        const text = newText
          .append('text')
          .attr('transform', (d) => `translate(${(-d.width + (d.radius * 2))/ 2}, ${d.radius + 5})`)  // position label below node without overlap
          .attr('fill', labelStyles.color || containerStyles.color)
          .attr('stroke', containerStyles['background-color'])
          .attr('stroke-width', '0.3px')
          .attr('font-size', (d) => Math.max(8, d.radius)) // label size is proportionate to node size
          .attr('font-weight', labelStyles.fontWeight)
          .attr('dominant-baseline', 'middle')
          .attr('text-anchor', 'start')

        text
          .selectAll('tspan')
          .data((d) => splitLongText(d[labelStyles.label], maxLineLength)) // max line length is 30
          .enter()
          .append('tspan')
          .attr('x', 0)
          .attr('y', (d, i) => 10.5 * i)
          .text((d) => d)

        return newText
      },
      (update) => update.call(updateFunc),
      exit => exit.call(exitFunc)
    )

    //ticked()

    function ticked () {
      linkG.selectAll('path.link').attr('d', (d) => (linkStyles.type === 'arc' ? generateArc(d, 1, true) : generatePath(d, true)))
      nodeG.selectAll('.node').attr('transform', (d) => `translate(${d.x}, ${d.y})`)
      textG.selectAll('.label').attr('transform', (d) => `translate(${d.x}, ${d.y})`)
      linkTexts.attr('x', (d) => (d.target.x - d.source.x) / 2 + d.source.x + 6).attr('y', (d) => (d.target.y - d.source.y) / 2 + d.source.y)
    }

    nodeG.selectAll('.node')
    .on('mouseover', function (event, dd) {
      updateTooltip(event, dd) // show tooltip on mouseover any node
      d3.select(this).select('circle').transition().duration(500).attr('r', (d) => d.radius * 1.2)
      d3.select('.label-' + dd.id.replaceAll(' ', '-')).transition().duration(500).attr('visibility', 'visible')
    })
    .on('mouseleave', function () {
      tooltipDiv.style('visibility', 'hidden')
      d3.select(this).select('circle').transition().duration(500).attr('r', (d) => d.radius)
      d3.selectAll('.label').transition().duration(500).attr('visibility', (d) => d.type === 'main' ? labelStyles.visibility : 'hidden')
    })
    
    function drag (simulation) {
      function dragstarted (event, d) {
        if (!event.active) simulation.alpha(0.1).alphaTarget(0.1).restart()
        d.fx = d.x
        d.fy = d.y
      }

      function dragged (event, d) {
        d.fx = event.x
        d.fy = event.y
        simulation.on('tick', ticked)
      }

      function dragended (event, d) {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      }

      return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended)
    }
  }
  ////////////////////////////////////////////////////////////////////////////////

  ///////////////////////// INTERACTION-RELATED FUNCTIONS ////////////////////////
  function highlightNode (dd) {
    nodeG.selectAll('.node').attr('opacity', (d) => (d.id === dd ? 1 : 0.2))
    linkG.selectAll('path.link').attr('opacity', 0.1)
    linkTextG.selectAll('text.link').attr('opacity', 0.1)
    textG.selectAll('.label').attr('visibility', (d) => (d.id === dd ? 'visible' : 'hidden'))
  }

  function highlightConnections (connectedNodes) {
    nodeG.selectAll('.node').attr('opacity', (d) => (connectedNodes.indexOf(d.id) !== -1 ? 1 : 0))
    linkG.selectAll('path.link').attr('opacity', (d) => (connectedNodes.indexOf(d.source.id) !== -1 && connectedNodes.indexOf(d.target.id) !== -1 ? 1 : 0))
    linkTextG.selectAll('text.link').attr('opacity', (d) => (connectedNodes.indexOf(d.source.id) !== -1 && connectedNodes.indexOf(d.target.id) !== -1 ? 1 : 0))
    textG.selectAll('.label').attr('visibility', (d) => (connectedNodes.indexOf(d.id) !== -1 ? 'visible' : 'hidden'))
  }

  // Un-highlight all elements and hide tooltip
  function reset () {
    nodeG.selectAll('.node').attr('opacity', 1)
    nodeG.selectAll('.node').selectAll('circle').attr('stroke', nodeStyles.stroke).attr('stroke-width', nodeStyles.strokeWidth)
    linkG.selectAll('path.link').attr('opacity', (d) => (showEle.links.length > 200 ? 0.25 : linkStyles.strokeOpacity))
    linkTextG.selectAll('text.link').attr('opacity', 1)
    textG.selectAll('.label').attr('visibility', labelStyles.visibility)

    tooltipDiv.style('visibility', 'hidden')

    if (searched) {
      svg.transition().duration(500).call(zoomHandler.transform, d3.zoomIdentity)
      searched = false
      document.getElementById('search-input').value = ''
      document.getElementById('suggestions-container').innerHTML = ''
      document.getElementById('reset-search').style.display = 'none'
      message.select('.shortestPath-status').html('')
    }

    // Undo clicked states
    clickedNN = false
    clickedSP = false
    clickedNodes = []
    message.select('.clickedNodes-1').html('')
    message.select('.clickedNodes-2').html('')
    message.select('.shortestPath-status').html('')
    message.style('visibility', 'hidden')

    tooltipDiv.style('visibility', 'hidden')
  }

  function clickedNodesFeedback (clickedNodes) {
    // Track which nodes have been clicked and render their names on screen
    if (clickedNodes[0]) d3.select('.clickedNodes-1').html('Start node: ' + clickedNodes[0])
    if (clickedNodes[1]) d3.select('.clickedNodes-2').html('End node: ' + clickedNodes[1])

    d3.select('.message').style('visibility', 'visible')
  }

  function findShortestPath (graph, clickedNodes) {
    // OUTWARD-BOUND only, meaning the first clickedNode has to be the source node of the path
    const connectedNodes = dijkstra.bidirectional(graph, clickedNodes[0], clickedNodes[1])
    if (connectedNodes) {
      // Only proceed with showing the nodes and paths that constitute the shortest path if it exist
      highlightConnections(connectedNodes)
    } else {
      // Provide feedback to user that no shortest path exist between the 2 nodes
      d3.select('.shortestPath-status').html('No shortest path found. Would you like to try again?')
    }
  }

  // Find neighboring connections of the clicked node (up to specified degrees away, OUTWARD-BOUND only: meaning target nodes their links)
  function findNeighbours(graph, dd_arr, DEGREE) {
    let connectedNodes = [];
    dd_arr.forEach((dd) => {
      bfsFromNode(graph, dd.id ? dd.id : dd, function (node, attr, depth) {
        if (depth <= DEGREE) {
          connectedNodes.push(node);
        }
      }, {mode: 'outbound'});
      bfsFromNode(graph, dd.id ? dd.id : dd, function (node, attr, depth) {
        if (depth <= DEGREE) {
          connectedNodes.push(node);
        }
      }, {mode: 'inbound'});   
    });
    return connectedNodes;
  }

  // function countConnections(links, entity, depth = 0) {
  //   if (visited.has(entity)) {
  //       // Skip if entity has already been visited to prevent infinite recursion
  //       return 0;
  //   }
  
  //   visited.add(entity);
  
  //   const entityRelations = links[entity];
  //   let count = entityRelations ? entityRelations.length : 0;
  
  //   if (count > 0 && Object.keys(links) !== 0 && entityRelations && entityRelations.length > 0) {
  //       entityRelations.forEach(relation => {
  //           count += countConnections(links, relation.Object, depth + 1);
  //       });
  //   }
  
  //   visited.delete(entity);
  
  //   return count;
  // }

  function countConnections(links, entity, depth = 0) {
    if (visited.has(entity)) {
        // Skip if entity has already been visited to prevent infinite recursion
        return 0;
    }
  
    visited.add(entity);
  
    const entityRelations = links.filter(d => d[sourceId] === entity);
    let count = entityRelations ? entityRelations.length : 0;
  
    if (count > 0 && entityRelations && entityRelations.length > 0) {
        entityRelations.forEach(relation => {
            count += countConnections(links, relation[sourceId], depth + 1);
        });
    }
  
    visited.delete(entity);
  
    return count;
  }
  
  // Function to color nodes based on neighbors
  function colorNodes(graph, nodes) {
    const visited = new Set();

    function traverse(node) {
      if (!visited.has(node)) {
        visited.add(node);
        const neighbors = findNeighbours(graph, [node], 1).slice(1);
        let nodeColor = getNodeColor(nodes, node);
        neighbors.forEach(neighbor => {
          const neighborColor = getNodeColor(nodes, neighbor);
          nodeColor = mixColors(nodeColor, neighborColor);
        });
        setNodeColor(nodes, node, nodeColor);
        neighbors.forEach(traverse);
      }
    }
    getRootNodes(graph).forEach(rootNode => traverse(rootNode));
  }
    
  function updateTooltip (event, d) {
    tooltip.custom(tooltipDiv, d)

    if (!tooltipDiv.innerHTML) {
      const content = []
      content.push(`<div style='padding-bottom: 4px; font-size: 18px; font-weight: bold; color: ${d.color}'>${d.id}</div>`) // tooltip title
      const keys = ['type', 'parent']
      keys.forEach((key) => {
        // iterate over each attribute object and render
        content.push(`<div><b>${key}: </b><span>${d[key]}</span></div>`)
      })
      let contentStr = ''
      content.map((d) => (contentStr += d))

      tooltipDiv.html(`${contentStr}`)
    }

    // const bbox = d3.select(".tooltip").node().getBoundingClientRect()
    const [x, y] = d3.pointer(event, d3.select('svg'));

    tooltipDiv
      .style('visibility', 'visible')
      .style('left', x + d.radius + 'px')
      .style('top', y + d.radius + 10 + 'px')
  }

  function updateLinkTooltip (event, d) {
    tooltip.custom(tooltipDiv, d)

    if (!tooltipDiv.innerHTML) {
      const content = []
      content.push(`<div style='padding-bottom: 4px; font-size: 18px; font-weight: bold;'><span style='color: ${d.source.color}'>${d.source.id}</span> -> <span style='color: ${d.target.color}'>${d.target.id}</span></div>`) // tooltip title
      const keys = ['Description', 'Relation', 'Object', 'Subject']
      keys.forEach((key) => {
        // iterate over each attribute object and render
        content.push(`<div><b>${key}: </b><span>${d[key]}</span></div>`)
      })
      let contentStr = ''
      content.map((d) => (contentStr += d))

      tooltipDiv.html(`${contentStr}`)
    }

    tooltipDiv
      .style('visibility', 'visible')
      .style('left', event.x + 10 + 'px')
      .style('top', event.y + 'px')
  }

  // Function to zoom to a specific node
  function zoomToNode (node) {
    // Calculate the new zoom transform
    const scale = 2 // You can adjust the zoom level as needed
    const x = -node.x * scale
    const y = -node.y * scale
    const transform = d3.zoomIdentity.translate(x, y).scale(scale)
    // Apply the new zoom transform with smooth transition
    svg.transition().duration(500).call(zoomHandler.transform, transform)
  }
  /// ///////////////////////////////////////////////////////////////////////////

  /// //////////////////// HELPER FUNCTIONS ////////////////////////
  function intern (value) {
    return value !== null && typeof value === 'object' ? value.valueOf() : value
  }

  function initGraphologyGraph (nodes, links) {
    // Initialize a new Graphology graph and add all nodes and edges to it
    // This will be used for shortest path and finding neighbours later
    const graph = new Graph()
  
    nodes.forEach((n) => {
      if (!graph.hasNode(n.id)) graph.addNode(n.id)
    })
    links.forEach((e) => {
      if (e.source.id && e.target.id) {
        if (graph.hasNode(e.source.id) && graph.hasNode(e.target.id)) {
          if (!graph.hasEdge(e.source.id, e.target.id)) {
            graph.addEdge(e.source.id, e.target.id)
          }
        }
      } else {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          if (!graph.hasEdge(e.source, e.target)) {
            graph.addEdge(e.source, e.target)
          }
        }
      }
    })
  
    return graph
  }

  function searchHandler (item) {
    searched = true
    const node = showEle.nodes.find((n) => n.id === item)
    if (node) {
      zoomToNode(node)
      highlightNode(item)
    } else {
      d3.select('.message').style('visibility', 'visible')
      d3.select('.shortestPath-status').html('No such node found.')
    }
  }

  function buttonClickHandler (buttonId) {
    // Check which button was clicked using its ID
    switch (buttonId) {
      case 'direction': // SHOW DIRECTION
        showArrows = !showArrows
        if (showArrows) {
          linkG.selectAll('path.link').attr('marker-end', 'url(#arrowhead)')
        } else {
          linkG.selectAll('path.link').attr('marker-end', null)
        }
        break
      case 'nearest_neighbour': // SHOW NEAREST NEIGHBOUR
        if (clickedSP || searched) return // disable action if screen is at shortest path view / searched node view
        showNeighbors = !showNeighbors
        if (!showNeighbors) {
          reset()
        }
        showShortestPath = false
        break
      case 'shortest_path': // SHOW SHORTEST PATH
        if (searched) return // disable action if screen is at searched node view
        showShortestPath = !showShortestPath
        if (!showShortestPath) {
          reset()
        }
        showNeighbors = false
        clickedNN = false
        break
      case 'hide_singlenodes':
        if (clickedSP || searched || clickedNN) return // disable action if screen is at shortest path view / searched node view  / nearest neighbor view
        // Note: If a single node is still shown on screen despite clicking the button, it's because some nodes have links where the source and target is the node itself.
        showSingleNodes = !showSingleNodes
        if (showSingleNodes) {
          // Find nodes without any connections
          const graph = initGraphologyGraph(showEle.nodes, showEle.links)
          singleNodeIDs = showEle.nodes.filter((n) => graph.degreeWithoutSelfLoops(n.id) === 0).map((d) => d.id)
          // Hide the opacity of these single nodes
          nodeG
            .selectAll('.node')
            .filter((d) => singleNodeIDs.indexOf(d.id) !== -1)
            .attr('opacity', 0)
          textG
            .selectAll('.label')
            .filter((d) => singleNodeIDs.indexOf(d.id) !== -1)
            .attr('visibility', 'hidden')
        } else {
          nodeG.selectAll('.node').attr('opacity', 1)
          textG.selectAll('.label').attr('visibility', labelStyles.visibility)
        }
        break
      case 'reset':
        reset()
        clickedNodes = []
        clickedSP = false
        clickedNN = false
        showArrows = false
        showNeighbors = false
        showShortestPath = false
        searched = false
        showSingleNodes = true
        break
      default:
        // Handle cases where an unknown button was clicked
        break
    }
  }

  return {
    /* public data update  method */
    update: ({nodes, links, redraw=true}) => {
      console.log(nodes, links)
      const N = d3.map(nodes, (d) => d[nodeId]).map(intern)
      const LS = d3.map(links, (d) => d[sourceId]).map(intern)
      const LT = d3.map(links, (d) => d[targetId]).map(intern)
      nodes = d3.map(nodes, (d, i) => ({
        id: N[i],
        ...d
      }))  
      links = d3.map(links, (d, i) => ({
        source: LS[i],
        target: LT[i],
        ...d
      }))
      nodes.forEach(d => {
        d.parent = findParent(links, d.entity)
        d.linkCnt = d.type === 'sub' ? 0 : countConnections(links, d.entity);
      })

      const ele = uniqueElements(nodes, links)
      updateAttributes(ele.nodes, ele.links)
      if(redraw){
        showEle.nodes = ele.nodes
        showEle.links = ele.links
      } else {
        showEle.nodes = showEle.nodes.concat(ele.nodes)
        showEle.links = showEle.links.concat(ele.links)
      }
      console.log(showEle.nodes, showEle.links)
      updateLayout()
    },
    /* public methods that (correspond to required functionality) */
    search: (searchString) => {
      searchHandler (searchString)
    },
    closeSearch: (searchString) => {
      reset()
    },
    filter: (options) => {
      console.log(ele.nodes, ele.links)
      const connectedNodes = findNeighbours(graph, options, 2);
      let entities = []
      connectedNodes.map(d => {
        entities.push(ele.nodes.find(node => node.entity === d) || {entity: d})
      })
      return {nodes: entities, links: ele.links.filter(d => connectedNodes.indexOf(d[sourceId]) !== -1 && connectedNodes.indexOf(d[targetId]) !== -1)}
    },
    /* event subscription method, provides interface for graph specific events e.g. click on node */
    on: (eventName, callback) => {
      if(eventName === 'nodeClick') {
        nodeG.selectAll('.node').on('click', function (event, d) {
          // Call the provided callback with the relevant information
          callback({
            clickedNodeData: d,
          });
        });
      }
    },
    showNearestNeighbour: () => {
      buttonClickHandler ('nearest_neighbour')
    },
    showShortestPath: () => {
      buttonClickHandler ('shortest_path')
    }
  }
}
