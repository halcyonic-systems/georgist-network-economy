import React, { useState, useCallback, useEffect, useRef } from 'react';

const GeorgistLandValueSimulation = () => {
  const GRID_SIZE = 10;
  const TOTAL_PARCELS = GRID_SIZE * GRID_SIZE;
  
  // Tab state
  const [activeTab, setActiveTab] = useState('simulation');
  
  // State
  const [immigrationRate, setImmigrationRate] = useState(5);
  const [minLeaseLength, setMinLeaseLength] = useState(1);
  const [maxLeaseLength, setMaxLeaseLength] = useState(10);
  const [maxWealth, setMaxWealth] = useState(26);
  const [vacancyDecay, setVacancyDecay] = useState(false);
  const [environmentMultiplier, setEnvironmentMultiplier] = useState(1.0);
  const [communityMultiplier, setCommunityMultiplier] = useState(1.0);
  const [round, setRound] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoRunTarget, setAutoRunTarget] = useState(null); // Target round for auto-run
  const [parcels, setParcels] = useState([]);
  const [unhoused, setUnhoused] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [history, setHistory] = useState([]); // Array of past states for time travel
  const [historyIndex, setHistoryIndex] = useState(-1); // Current position in history (-1 means latest)
  const intervalRef = useRef(null);
  
  // Scenario presets
  const scenarios = [
    {
      id: 'balanced',
      title: 'Balanced Market',
      description: 'Moderate settings across the board. A good starting point to observe natural market dynamics without extreme pressures.',
      settings: { immigrationRate: 10, minLeaseLength: 5, maxLeaseLength: 15, maxWealth: 26, vacancyDecay: true, environmentMultiplier: 1.0, communityMultiplier: 1.0 }
    },
    {
      id: 'inequality',
      title: 'Extreme Inequality',
      description: 'Demonstrates a radically free market with maximum diversity along all parameters. High wealth ceiling and doubled land value multipliers create intense competition.',
      settings: { immigrationRate: 10, minLeaseLength: 1, maxLeaseLength: 25, maxWealth: 50, vacancyDecay: false, environmentMultiplier: 2.0, communityMultiplier: 2.0 }
    },
    {
      id: 'stable-community',
      title: 'Stable Community',
      description: 'Long leases, low immigration, and less wealth inequality. Creates neighborhoods where tenants stay longer and price changes happen slowly.',
      settings: { immigrationRate: 5, minLeaseLength: 15, maxLeaseLength: 25, maxWealth: 25, vacancyDecay: true, environmentMultiplier: 1.0, communityMultiplier: 1.0 }
    },
    {
      id: 'high-churn',
      title: 'High Churn (Short-Term Rentals)',
      description: 'Simulates a market dominated by short-term leases like Airbnb or corporate housing. Very short leases (1-3 rounds) create constant turnover and fierce competition every few rounds.',
      settings: { immigrationRate: 15, minLeaseLength: 1, maxLeaseLength: 3, maxWealth: 40, vacancyDecay: false, environmentMultiplier: 1.5, communityMultiplier: 1.5 }
    },
    {
      id: 'distinct-neighbourhoods',
      title: 'Distinct Neighbourhoods',
      description: 'Higher environmental weight relative to community score creates strips of desirability that more accurately mimic the demand you might see in a city with various neighborhoods of differing quality.',
      settings: { immigrationRate: 10, minLeaseLength: 1, maxLeaseLength: 10, maxWealth: 30, vacancyDecay: true, environmentMultiplier: 1.8, communityMultiplier: 0.2 }
    },
    {
      id: 'declining-city',
      title: 'Declining City (Rust Belt)',
      description: 'Low immigration and strong vacancy decay simulate population decline. Environment matters little; community is everything. Watch neighborhoods hollow out.',
      settings: { immigrationRate: 3, minLeaseLength: 5, maxLeaseLength: 15, maxWealth: 20, vacancyDecay: true, environmentMultiplier: 0.5, communityMultiplier: 2.0 }
    }
  ];
  
  // Initialize parcels
  const initializeParcels = useCallback(() => {
    const newParcels = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        newParcels.push({
          id: row * GRID_SIZE + col,
          row,
          col,
          environmentScore: col + 1, // Column 1 = 1, Column 10 = 10
          communityScore: 0,
          occupant: null,
          leasePrice: null, // Price locked in when lease was formed
          roundsVacant: 0, // Current vacancy streak
          totalRoundsVacant: 0, // Cumulative rounds vacant
          history: [], // Array of events: { round, type, details }
        });
      }
    }
    return newParcels;
  }, []);
  
  // Calculate community score for a parcel
  const calculateCommunityScore = useCallback((parcelIndex, parcelsState) => {
    const parcel = parcelsState[parcelIndex];
    const { row, col } = parcel;
    let score = 0;
    
    // Immediate neighbors (8 cells, +1 each)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
          const neighborIndex = nr * GRID_SIZE + nc;
          if (parcelsState[neighborIndex].occupant) {
            score += 1;
          }
        }
      }
    }
    
    // Outer ring neighbors (up to 16 cells, +0.5 each)
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        // Skip inner ring and center
        if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
          const neighborIndex = nr * GRID_SIZE + nc;
          if (parcelsState[neighborIndex].occupant) {
            score += 0.5;
          }
        }
      }
    }
    
    return score;
  }, []);
  
  // Update all community scores
  const updateAllCommunityScores = useCallback((parcelsState) => {
    return parcelsState.map((parcel, index) => ({
      ...parcel,
      communityScore: calculateCommunityScore(index, parcelsState),
    }));
  }, [calculateCommunityScore]);
  
  // Get display value of a parcel
  // If occupied, shows the lease price (what's being paid)
  // If vacant, shows environment + community (with optional decay discount)
  const getCurrentValue = (parcel) => {
    if (parcel.occupant && parcel.leasePrice) {
      return parcel.leasePrice;
    }
    const envValue = parcel.environmentScore * environmentMultiplier;
    const baseValue = envValue + (parcel.communityScore * communityMultiplier);
    if (vacancyDecay && parcel.roundsVacant > 0) {
      // Decay can reduce community premium but not below environment value
      return Math.max(envValue, baseValue - (parcel.roundsVacant * 0.5));
    }
    return baseValue;
  };
  
  // Color interpolation for parcels (red -> orange -> yellow -> green)
  const getParcelColor = (desirability) => {
    const normalized = (desirability - 1) / 25; // 0 to 1
    
    // Red (1) -> Orange (9) -> Yellow (17) -> Green (26)
    if (normalized < 0.33) {
      // Red to Orange
      const t = normalized / 0.33;
      const r = 220;
      const g = Math.round(60 + t * 120);
      const b = Math.round(60 - t * 20);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (normalized < 0.66) {
      // Orange to Yellow
      const t = (normalized - 0.33) / 0.33;
      const r = Math.round(220 - t * 20);
      const g = Math.round(180 + t * 40);
      const b = Math.round(40 + t * 20);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Yellow to Green
      const t = (normalized - 0.66) / 0.34;
      const r = Math.round(200 - t * 130);
      const g = Math.round(220 - t * 30);
      const b = Math.round(60 + t * 60);
      return `rgb(${r}, ${g}, ${b})`;
    }
  };
  
  // Color for agents (light blue to dark blue)
  const getAgentColor = (wealth) => {
    const normalized = (wealth - 1) / 25; // 0 to 1
    const lightness = 80 - normalized * 50; // 80% to 30%
    return `hsl(210, 70%, ${lightness}%)`;
  };
  
  // Separate effect to handle the complex round logic properly
  const processRoundRef = useRef(null);
  
  processRoundRef.current = () => {
    const currentRound = round + 1;
    
    // Save current state to history before advancing
    const currentState = {
      round,
      parcels: parcels.map(p => ({ 
        ...p, 
        occupant: p.occupant ? { ...p.occupant } : null,
        history: [...(p.history || [])],
      })),
      unhoused: unhoused.map(a => ({ ...a })),
    };
    
    setHistory(prev => {
      const newHistory = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
      return [...newHistory, currentState];
    });
    setHistoryIndex(-1);
    
    let workingParcels = parcels.map(p => ({ 
      ...p, 
      occupant: p.occupant ? { ...p.occupant } : null,
      history: [...(p.history || [])] 
    }));
    let workingUnhoused = [...unhoused].map(a => ({ ...a }));
    
    // STEP 1: Update community scores first (so current values are accurate)
    workingParcels = workingParcels.map((parcel, index) => ({
      ...parcel,
      communityScore: calculateCommunityScore(index, workingParcels),
    }));
    
    // STEP 2: Identify expired leases - these lots go to auction
    const lotsForAuction = []; // { index, currentValue, defender }
    const expiredLeaseAgents = [];
    
    for (let i = 0; i < workingParcels.length; i++) {
      const parcel = workingParcels[i];
      if (parcel.occupant) {
        const leaseExpires = parcel.occupant.leaseStart + parcel.occupant.leaseLength;
        if (currentRound >= leaseExpires) {
          const currentValue = (parcel.environmentScore * environmentMultiplier) + (parcel.communityScore * communityMultiplier);
          
          lotsForAuction.push({
            index: i,
            currentValue: currentValue,
            defender: { ...parcel.occupant }
          });
          
          expiredLeaseAgents.push({ 
            ...parcel.occupant, 
            previousParcelIndex: i,
            isDefender: true 
          });
          
          // Log lease expiration
          workingParcels[i].history.push({
            round: currentRound,
            type: 'lease_expired',
            details: { 
              agent: { id: parcel.occupant.id, wealth: parcel.occupant.wealth },
              leaseStart: parcel.occupant.leaseStart,
              leaseLength: parcel.occupant.leaseLength,
              leasePrice: parcel.leasePrice,
              currentValue: currentValue
            }
          });
          
          // Clear occupant - they enter the auction as defender
          workingParcels[i] = { 
            ...workingParcels[i], 
            occupant: null,
            leasePrice: null
          };
        }
      }
    }
    
    // Also add vacant lots to auction pool
    for (let i = 0; i < workingParcels.length; i++) {
      const parcel = workingParcels[i];
      if (!parcel.occupant && !lotsForAuction.find(l => l.index === i)) {
        const envValue = parcel.environmentScore * environmentMultiplier;
        const baseValue = envValue + (parcel.communityScore * communityMultiplier);
        // Apply vacancy decay if enabled - floor at environment value
        const currentValue = vacancyDecay && parcel.roundsVacant > 0
          ? Math.max(envValue, baseValue - (parcel.roundsVacant * 0.5))
          : baseValue;
        lotsForAuction.push({
          index: i,
          currentValue: currentValue,
          baseValue: baseValue, // Track base for history
          defender: null // No defender for vacant lots
        });
      }
    }
    
    // STEP 4: Collect all agents needing placement
    let allAgents = [];
    const seenAgentIds = new Set(); // Track IDs to prevent duplicates
    
    // First, collect IDs of agents who are ALREADY housed with active leases
    // These agents should NOT participate in any auctions
    const alreadyHousedIds = new Set();
    for (const parcel of workingParcels) {
      if (parcel.occupant) {
        const leaseExpires = parcel.occupant.leaseStart + parcel.occupant.leaseLength;
        if (currentRound < leaseExpires) {
          // This agent has an active lease - they can't participate in auctions
          alreadyHousedIds.add(parcel.occupant.id);
        }
      }
    }
    
    // Expired lease agents (defenders)
    for (const agent of expiredLeaseAgents) {
      if (!seenAgentIds.has(agent.id) && !alreadyHousedIds.has(agent.id)) {
        seenAgentIds.add(agent.id);
        allAgents.push({ ...agent, source: 'expired_lease' });
      }
    }
    
    // Previously unhoused
    for (const agent of workingUnhoused) {
      if (!seenAgentIds.has(agent.id) && !alreadyHousedIds.has(agent.id)) {
        seenAgentIds.add(agent.id);
        allAgents.push({ ...agent, source: 'unhoused' });
      }
    }
    
    // New immigrants - use truly unique IDs
    for (let i = 0; i < immigrationRate; i++) {
      // Generate unique ID using timestamp + random + index to guarantee uniqueness
      const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${currentRound}-${i}`;
      seenAgentIds.add(uniqueId);
      allAgents.push({
        id: uniqueId,
        wealth: Math.floor(Math.random() * maxWealth) + 1,
        roundEntered: currentRound,
        source: 'new_immigrant',
      });
    }
    
    // Sort lots by current value (highest first) - best lots auction first
    lotsForAuction.sort((a, b) => b.currentValue - a.currentValue);
    
    // Sort agents by wealth (highest first)
    allAgents.sort((a, b) => b.wealth - a.wealth);
    
    const newUnhoused = [];
    const placedAgentIds = new Set();
    
    // STEP 5: Run auctions for each lot (highest value first)
    for (const lot of lotsForAuction) {
      let { index, currentValue, defender } = lot;
      
      // IMPORTANT: If defender was already placed this round (won another lot), they can't defend
      if (defender && placedAgentIds.has(defender.id)) {
        defender = null; // They already have a home, treat lot as vacant
      }
      
      // Find the defender in allAgents BEFORE filtering (they might not be able to afford)
      let defenderInPool = defender ? allAgents.find(a => a.id === defender.id) : null;
      
      // Double-check defenderInPool isn't already placed
      if (defenderInPool && placedAgentIds.has(defenderInPool.id)) {
        defenderInPool = null;
      }
      
      // Find all agents who can afford this lot and aren't placed yet
      const eligibleAgents = allAgents.filter(a => 
        !placedAgentIds.has(a.id) && a.wealth >= currentValue
      );
      
      if (eligibleAgents.length === 0) {
        // No one can afford this lot - it stays vacant
        if (defender) {
          // Defender couldn't afford their own lot anymore
          workingParcels[index].history.push({
            round: currentRound,
            type: 'priced_out',
            details: { 
              agent: { id: defender.id, wealth: defender.wealth },
              currentValue: currentValue,
              reason: 'Defender could not afford new market rate'
            }
          });
        }
        continue;
      }
      
      // The challenger is the wealthiest eligible agent who is NOT the defender
      const challenger = eligibleAgents.find(a => !defender || a.id !== defender.id);
      
      // Determine auction outcome
      let winner = null;
      let leasePrice = currentValue;
      let wasContested = false;
      let auctionDetails = {};
      
      if (!defender) {
        // Vacant lot auction
        winner = eligibleAgents[0]; // Wealthiest eligible
        
        // If there's competition (more than one eligible agent), price is driven up
        // Second-price auction: winner pays the second-highest bid (or market value if no competition)
        if (eligibleAgents.length > 1) {
          // Second highest bidder's wealth determines the price
          // Winner pays second-place wealth + 1 (or market value, whichever is higher)
          const secondHighest = eligibleAgents[1];
          leasePrice = Math.max(currentValue, secondHighest.wealth);
          wasContested = true;
          auctionDetails = { 
            type: 'contested_vacant',
            runnerUp: { id: secondHighest.id, wealth: secondHighest.wealth },
          };
        } else {
          // No competition - winner pays market value
          leasePrice = currentValue;
          wasContested = false;
          auctionDetails = { type: 'vacant_claim' };
        }
        
      } else if (!challenger) {
        // Defender is the only one who can afford it - uncontested renewal
        // Use defenderInPool if available (has proper metadata), otherwise use defender
        winner = defenderInPool || defender;
        leasePrice = currentValue;
        wasContested = false;
        auctionDetails = { type: 'uncontested_renewal' };
        
      } else if (challenger.wealth > defender.wealth) {
        // Challenger wins - pays max of market value or defender's wealth + 1
        winner = challenger;
        leasePrice = Math.max(currentValue, defender.wealth + 1);
        wasContested = true;
        auctionDetails = { 
          type: 'challenger_wins',
          defender: { id: defender.id, wealth: defender.wealth },
          winningBid: leasePrice
        };
        
      } else if (challenger.wealth === defender.wealth) {
        // Tie - defender wins but pays full amount (challenger's wealth)
        winner = defenderInPool || defender;
        leasePrice = challenger.wealth;
        wasContested = true;
        auctionDetails = { 
          type: 'defender_wins_tie',
          challenger: { id: challenger.id, wealth: challenger.wealth },
          pricePaid: leasePrice
        };
        
      } else {
        // Defender wealth > challenger wealth - defender wins
        // Pays max(currentValue, challenger wealth + 1)
        winner = defenderInPool || defender;
        leasePrice = Math.max(currentValue, challenger.wealth + 1);
        wasContested = true;
        auctionDetails = { 
          type: 'defender_wins',
          challenger: { id: challenger.id, wealth: challenger.wealth },
          pricePaid: leasePrice
        };
      }
      
      // Place the winner
      const leaseLength = Math.floor(Math.random() * (maxLeaseLength - minLeaseLength + 1)) + minLeaseLength;
      
      // Record history
      workingParcels[index].history.push({
        round: currentRound,
        type: wasContested ? 'auction_won' : 'occupied',
        details: {
          agent: { id: winner.id, wealth: winner.wealth },
          source: winner.source,
          leaseLength: leaseLength,
          leasePrice: leasePrice,
          currentValue: currentValue,
          ...auctionDetails
        }
      });
      
      // Remove metadata before storing
      const { source, previousParcelIndex, isDefender, ...agentClean } = winner;
      
      // DEBUG: Check if agent has no ID
      if (!agentClean.id) {
        console.error('WARNING: Agent being placed without ID!', { winner, agentClean, index, currentRound });
      }
      
      // SAFEGUARD: Ensure this agent is not on any other parcel
      // If found on another parcel, clear them - one agent can only be on one parcel
      for (let j = 0; j < workingParcels.length; j++) {
        if (j !== index && workingParcels[j].occupant && workingParcels[j].occupant.id === winner.id) {
          console.warn('DUPLICATE AGENT DETECTED! Clearing from parcel', j, 'to place on parcel', index, 'Agent ID:', winner.id);
          workingParcels[j] = {
            ...workingParcels[j],
            occupant: null,
            leasePrice: null
          };
        }
      }
      
      workingParcels[index] = {
        ...workingParcels[index],
        occupant: {
          ...agentClean,
          leaseStart: currentRound,
          leaseLength: leaseLength,
        },
        leasePrice: leasePrice,
        roundsVacant: 0,
        justOccupied: true,
      };
      
      placedAgentIds.add(winner.id);
    }
    
    // STEP 6: Any unplaced agents become unhoused
    const unplacedAgentIds = new Set(); // Prevent duplicates in unhoused
    for (const agent of allAgents) {
      if (!placedAgentIds.has(agent.id) && !unplacedAgentIds.has(agent.id)) {
        unplacedAgentIds.add(agent.id);
        const { source, previousParcelIndex, isDefender, ...agentClean } = agent;
        newUnhoused.push(agentClean);
      }
    }
    
    // STEP 7: Increment roundsVacant for lots that remained vacant after auctions
    for (let i = 0; i < workingParcels.length; i++) {
      const parcel = workingParcels[i];
      // Only increment if truly vacant (no occupant AND wasn't just occupied this round)
      if (!parcel.occupant && !parcel.justOccupied) {
        workingParcels[i] = {
          ...parcel,
          roundsVacant: (parcel.roundsVacant || 0) + 1,
          totalRoundsVacant: (parcel.totalRoundsVacant || 0) + 1
        };
      }
      // Clear the justOccupied flag
      if (parcel.justOccupied) {
        workingParcels[i] = {
          ...workingParcels[i],
          justOccupied: undefined
        };
      }
    }
    
    // STEP 8: Final community score update
    workingParcels = workingParcels.map((parcel, index) => ({
      ...parcel,
      communityScore: calculateCommunityScore(index, workingParcels),
    }));
    
    // FINAL SAFETY CHECK: Collect all agent IDs that are housed on parcels
    // and remove any duplicates from unhoused list
    const housedAgentIds = new Set();
    for (const parcel of workingParcels) {
      if (parcel.occupant && parcel.occupant.id) {
        housedAgentIds.add(parcel.occupant.id);
      }
    }
    
    // Filter unhoused to remove any agents who are actually housed
    // and deduplicate by ID (keep first occurrence)
    const seenIds = new Set();
    const finalUnhoused = [];
    for (const agent of newUnhoused) {
      if (!housedAgentIds.has(agent.id) && !seenIds.has(agent.id)) {
        seenIds.add(agent.id);
        finalUnhoused.push(agent);
      }
    }
    
    // Update state
    setParcels(workingParcels);
    setUnhoused(finalUnhoused);
    setRound(currentRound);
  };

  // Initialize on mount
  useEffect(() => {
    setParcels(initializeParcels());
  }, [initializeParcels]);
  
  // Stop when reaching auto-run target
  useEffect(() => {
    // Stop at auto-run target
    if (autoRunTarget !== null && round >= autoRunTarget && isPlaying) {
      setIsPlaying(false);
      setAutoRunTarget(null);
    }
  }, [round, isPlaying, autoRunTarget]);
  
  // Play/pause logic - use faster interval for auto-run
  useEffect(() => {
    if (isPlaying) {
      const speed = autoRunTarget !== null ? 100 : 1000; // Fast when auto-running
      intervalRef.current = setInterval(() => {
        if (processRoundRef.current) {
          processRoundRef.current();
        }
      }, speed);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, autoRunTarget]);
  
  // Reset
  const handleReset = () => {
    setIsPlaying(false);
    setRound(0);
    setParcels(initializeParcels());
    setUnhoused([]);
    setSelectedAgent(null);
    setSelectedParcel(null);
    setHistory([]);
    setHistoryIndex(-1);
  };
  
  // Download simulation data as CSV
  const downloadCSV = () => {
    // Build CSV content
    let csv = 'Parcel ID,Row,Column,Environment Score,Community Score,Market Value,Lease Price,Occupant Wealth,Occupant ID,Lease Start,Lease End,Current Vacancy Streak,Total Rounds Vacant\n';
    
    for (const parcel of parcels) {
      const marketValue = (parcel.environmentScore * environmentMultiplier) + (parcel.communityScore * communityMultiplier);
      const row = [
        parcel.id,
        Math.floor(parcel.id / 10) + 1,
        (parcel.id % 10) + 1,
        parcel.environmentScore,
        parcel.communityScore.toFixed(1),
        marketValue.toFixed(1),
        parcel.leasePrice || '',
        parcel.occupant ? parcel.occupant.wealth : '',
        parcel.occupant ? parcel.occupant.id : '',
        parcel.occupant ? parcel.occupant.leaseStart : '',
        parcel.occupant ? parcel.occupant.leaseStart + parcel.occupant.leaseLength : '',
        parcel.roundsVacant || 0,
        parcel.totalRoundsVacant || 0
      ];
      csv += row.join(',') + '\n';
    }
    
    // Add summary section
    csv += '\n\nSIMULATION PARAMETERS\n';
    csv += 'Parameter,Value\n';
    csv += `Round,${round}\n`;
    csv += `Immigration Rate,${immigrationRate}\n`;
    csv += `Min Lease Length,${minLeaseLength}\n`;
    csv += `Max Lease Length,${maxLeaseLength}\n`;
    csv += `Max Wealth,${maxWealth}\n`;
    csv += `Environment Multiplier,${environmentMultiplier}\n`;
    csv += `Community Multiplier,${communityMultiplier}\n`;
    csv += `Vacancy Decay,${vacancyDecay}\n`;
    csv += `Occupied Lots,${parcels.filter(p => p.occupant).length}\n`;
    csv += `Vacant Lots,${parcels.filter(p => !p.occupant).length}\n`;
    csv += `Unhoused Agents,${unhoused.length}\n`;
    
    // Add unhoused agents
    if (unhoused.length > 0) {
      csv += '\n\nUNHOUSED AGENTS\n';
      csv += 'Agent ID,Wealth,Round Entered\n';
      for (const agent of unhoused) {
        csv += `${agent.id},${agent.wealth},${agent.roundEntered || ''}\n`;
      }
    }
    
    // Create and trigger download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `georgist-sim-round-${round}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  // Apply scenario preset
  const applyScenario = (scenario) => {
    setIsPlaying(false);
    setRound(0);
    setParcels(initializeParcels());
    setUnhoused([]);
    setSelectedAgent(null);
    setSelectedParcel(null);
    setHistory([]);
    setHistoryIndex(-1);
    setImmigrationRate(scenario.settings.immigrationRate);
    setMinLeaseLength(scenario.settings.minLeaseLength);
    setMaxLeaseLength(scenario.settings.maxLeaseLength);
    setMaxWealth(scenario.settings.maxWealth);
    setVacancyDecay(scenario.settings.vacancyDecay || false);
    setEnvironmentMultiplier(scenario.settings.environmentMultiplier || 1.0);
    setCommunityMultiplier(scenario.settings.communityMultiplier || 1.0);
    setActiveTab('simulation');
  };
  
  // Step backward in time
  const handleStepBack = () => {
    if (history.length === 0) return;
    
    // If we're at latest, save current state first then go back
    if (historyIndex === -1) {
      const currentState = {
        round,
        parcels: parcels.map(p => ({ ...p, occupant: p.occupant ? { ...p.occupant } : null })),
        unhoused: unhoused.map(a => ({ ...a })),
      };
      setHistory(prev => [...prev, currentState]);
      
      // Go to second-to-last state
      const targetIndex = history.length - 1;
      const targetState = history[targetIndex];
      setRound(targetState.round);
      setParcels(targetState.parcels);
      setUnhoused(targetState.unhoused);
      setHistoryIndex(targetIndex);
    } else if (historyIndex > 0) {
      // Go further back
      const targetIndex = historyIndex - 1;
      const targetState = history[targetIndex];
      setRound(targetState.round);
      setParcels(targetState.parcels);
      setUnhoused(targetState.unhoused);
      setHistoryIndex(targetIndex);
    }
  };
  
  // Step forward in time (either replay history or advance simulation)
  const handleStepForward = () => {
    if (historyIndex >= 0 && historyIndex < history.length - 1) {
      // We're in history, move forward through it
      const targetIndex = historyIndex + 1;
      const targetState = history[targetIndex];
      setRound(targetState.round);
      setParcels(targetState.parcels);
      setUnhoused(targetState.unhoused);
      setHistoryIndex(targetIndex);
    } else {
      // We're at the latest state, advance simulation
      setHistoryIndex(-1);
      if (processRoundRef.current) {
        processRoundRef.current();
      }
    }
  };
  
  // Count occupied parcels
  const occupiedCount = parcels.filter(p => p.occupant).length;
  
  // Get live data for selected agent (they may have moved, renewed lease, etc.)
  const getLiveAgentData = () => {
    if (!selectedAgent) return null;
    
    // Check if agent is on a parcel
    for (const parcel of parcels) {
      if (parcel.occupant && parcel.occupant.id === selectedAgent.id) {
        return { agent: parcel.occupant, status: 'housed', parcelIndex: parcel.id };
      }
    }
    
    // Check if agent is unhoused
    for (const agent of unhoused) {
      if (agent.id === selectedAgent.id) {
        return { agent, status: 'unhoused', parcelIndex: null };
      }
    }
    
    // Agent no longer exists (shouldn't happen, but handle gracefully)
    return null;
  };
  
  const liveAgentData = getLiveAgentData();
  
  // Get live data for selected parcel
  const getLiveParcelData = () => {
    if (!selectedParcel) return null;
    
    // Find the current state of this parcel
    const liveParcel = parcels.find(p => p.id === selectedParcel.id);
    return liveParcel || null;
  };
  
  const liveParcelData = getLiveParcelData();
  
  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      padding: '24px',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      color: '#2c3e50',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: '16px',
      }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '600',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          margin: '0 0 8px 0',
          background: 'linear-gradient(90deg, #f39c12, #e74c3c)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Georgist Land Value Simulation
        </h1>
        <p style={{
          fontSize: '14px',
          color: '#7f8c8d',
          margin: 0,
        }}>
          An agent-based model demonstrating how land value emerges from environment and community
        </p>
      </div>
      
      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '8px',
        marginBottom: '24px',
      }}>
        {[
          { id: 'simulation', label: 'Simulation' },
          { id: 'guide', label: 'User Guide' },
          { id: 'scenarios', label: 'Scenarios' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: activeTab === tab.id ? '1px solid #f39c12' : '1px solid #ddd',
              background: activeTab === tab.id ? 'rgba(243, 156, 18, 0.15)' : '#f8f9fa',
              color: activeTab === tab.id ? '#f39c12' : '#7f8c8d',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* User Guide Tab */}
      {activeTab === 'guide' && (
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          background: '#f8f9fa',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e9ecef',
        }}>
          {/* Two Column Layout for Core Concepts and Parameters */}
          <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {/* Left Column - Core Concepts */}
            <div style={{ flex: '1', minWidth: '320px' }}>
              <h3 style={{ color: '#27ae60', marginTop: 0, marginBottom: '12px' }}>Core Concepts</h3>
              
              <h4 style={{ color: '#2c3e50', fontWeight: '700', marginBottom: '8px' }}>
                <span style={{ textDecoration: 'underline' }}>Land Value Calculation</span>
              </h4>
              <p style={{ color: '#7f8c8d', lineHeight: '1.6', margin: '0 0 8px 0' }}>
                Each parcel's <strong style={{ color: '#2c3e50' }}>market value</strong> = (Environment × Weight) + (Community × Weight)
              </p>
              <ul style={{ color: '#7f8c8d', lineHeight: '1.6', margin: '0 0 12px 0', paddingLeft: '20px' }}>
                <li><strong style={{ color: '#2c3e50' }}>Environment (1-10)</strong>: Fixed by column position. Left edge = 1, Right edge = 10. Represents inherent locational advantages.</li>
                <li><strong style={{ color: '#2c3e50' }}>Community (0-16)</strong>: Dynamic score based on neighbors. +1 per adjacent occupied lot, +0.5 per diagonal neighbor. Updates each round as the population shifts.</li>
              </ul>
              
              <h4 style={{ color: '#2c3e50', fontWeight: '700', marginBottom: '8px' }}>
                <span style={{ textDecoration: 'underline' }}>Display Values</span>
              </h4>
              <ul style={{ color: '#7f8c8d', lineHeight: '1.6', margin: 0, paddingLeft: '20px' }}>
                <li><strong style={{ color: '#2c3e50' }}>Occupied parcels</strong> display their <strong>lease price</strong>—the rate the tenant locked in at auction.</li>
                <li><strong style={{ color: '#2c3e50' }}>Vacant parcels</strong> display their <strong>market value</strong>—what a new tenant would pay today.</li>
              </ul>
            </div>
            
            {/* Right Column - Parameters */}
            <div style={{ flex: '1', minWidth: '320px' }}>
              <h3 style={{ color: '#27ae60', marginTop: 0, marginBottom: '12px' }}>Parameters</h3>
              <ul style={{ color: '#7f8c8d', lineHeight: '1.6', margin: 0, paddingLeft: '20px' }}>
                <li><strong style={{ color: '#2c3e50' }}>Immigration Rate</strong>: Number of new agents entering each round. Higher values create more competition for available lots.</li>
                <li><strong style={{ color: '#2c3e50' }}>Lease Length (Min/Max)</strong>: Range for randomly assigned lease durations. Longer leases mean more stability but slower price discovery; shorter leases create more frequent auctions.</li>
                <li><strong style={{ color: '#2c3e50' }}>Max Wealth</strong>: Upper bound for agent wealth (randomly assigned 1 to max). When max wealth is below maximum possible land value, some lots may be permanently unaffordable.</li>
                <li><strong style={{ color: '#2c3e50' }}>Vacancy Decay</strong>: When enabled, vacant lots lose 0.5 value per round they sit empty. Creates downward pressure on prices for unoccupied land until someone can afford it.</li>
                <li><strong style={{ color: '#2c3e50' }}>Environment Weight</strong>: Multiplier for the environment score (0x-2x). At 0x, location doesn't matter. At 2x, column position has double the impact on price.</li>
                <li><strong style={{ color: '#2c3e50' }}>Community Weight</strong>: Multiplier for the community score (0x-2x). At 0x, neighbors don't affect value. At 2x, clustering effects are amplified.</li>
              </ul>
            </div>
          </div>
          
          {/* Round Order of Operations */}
          <h3 style={{ color: '#27ae60', marginTop: 0, marginBottom: '8px' }}>🔄 Round Order of Operations</h3>
          <p style={{ color: '#7f8c8d', lineHeight: '1.5', marginBottom: '12px' }}>
            Each round follows a specific sequence. The order matters—community scores update before auctions so prices reflect current conditions.
          </p>
          
          <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(100, 255, 218, 0.2)' }}>
                  <th style={{ padding: '10px', textAlign: 'center', borderBottom: '2px solid rgba(100, 255, 218, 0.5)', color: '#27ae60', width: '50px' }}>Step</th>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(100, 255, 218, 0.5)', color: '#27ae60', width: '180px' }}>Action</th>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(100, 255, 218, 0.5)', color: '#27ae60' }}>Details & Reasoning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#3498db', fontWeight: '700', fontSize: '16px' }}>1</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>📊 Update Community Scores</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Recalculate neighbor bonuses for every parcel based on current occupancy. This ensures auctions use <em>current</em> market values, not stale data.
                    <span style={{ color: '#27ae60' }}> → Land value emerges from community, updated in real-time.</span>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#9b59b6', fontWeight: '700', fontSize: '16px' }}>2</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>📋 Identify Expired Leases</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Find all lots where <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>round ≥ leaseStart + leaseLength</code>. These go to auction with their current occupant as Defender.
                    <span style={{ color: '#27ae60' }}> → Leases are temporary—no one owns land forever.</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#e67e22', fontWeight: '700', fontSize: '16px' }}>3</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>🏘️ Collect Available Lots</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Pool all expired-lease lots + already-vacant lots. <strong style={{ color: '#2c3e50' }}>Sort by market value (highest first)</strong>.
                    <span style={{ color: '#27ae60' }}> → Most valuable lots auction first, attracting the wealthiest bidders.</span>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#e67e22', fontWeight: '700', fontSize: '16px' }}>4</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>👥 Collect Agents</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Pool: (1) Defenders from expired leases, (2) Previously unhoused agents, (3) New immigrants. <strong style={{ color: '#2c3e50' }}>Sort by wealth (highest first)</strong>.
                    <span style={{ color: '#27ae60' }}> → Wealthy agents get first shot at premium lots = efficient market matching.</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#e74c3c', fontWeight: '700', fontSize: '16px' }}>5</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>⚖️ Run Auctions</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Process each lot in order. For each: find the Challenger (wealthiest unplaced agent who can afford it), resolve via auction rules below, assign winner a new lease of random length.
                    <span style={{ color: '#27ae60' }}> → The core mechanism where prices are discovered and land is allocated.</span>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#27ae60', fontWeight: '700', fontSize: '16px' }}>6</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>🏚️ Mark Unplaced Agents</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Agents who couldn't afford any available lot become "unhoused." They'll try again next round.
                    <span style={{ color: '#27ae60' }}> → Tracks housing insecurity when land values exceed what some can pay.</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', textAlign: 'center', color: '#95a5a6', fontWeight: '700', fontSize: '16px' }}>7</td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>⏱️ Update Vacancy Counters</strong>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Lots that remained vacant get their counter incremented. If Vacancy Decay is enabled, this reduces their effective price next round.
                    <span style={{ color: '#27ae60' }}> → Persistent vacancies signal overpricing; decay creates pressure to fill land.</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          {/* Auction System */}
          <h3 style={{ color: '#27ae60', marginTop: 0, marginBottom: '8px' }}>⚖️ The Auction System</h3>
          <p style={{ color: '#7f8c8d', lineHeight: '1.5', marginBottom: '12px' }}>
            When a lease expires, the lot goes to auction. The previous tenant becomes the <strong style={{ color: '#2c3e50' }}>Defender</strong>, and the wealthiest agent who wants the lot becomes the <strong style={{ color: '#2c3e50' }}>Challenger</strong>.
          </p>
          
          <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(243, 156, 18, 0.2)' }}>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(243, 156, 18, 0.5)', color: '#f39c12', width: '160px' }}>Scenario</th>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(243, 156, 18, 0.5)', color: '#f39c12', width: '120px' }}>Winner</th>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(243, 156, 18, 0.5)', color: '#f39c12', width: '140px' }}>Price Paid</th>
                  <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid rgba(243, 156, 18, 0.5)', color: '#f39c12' }}>Why This Rule?</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: 'rgba(155, 89, 182, 0.1)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>🏚️ Vacant lot</strong><br/>
                    <span style={{ color: '#7f8c8d', fontSize: '11px' }}>No defender exists</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#27ae60' }}>
                    Wealthiest eligible agent
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    Market value
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    No competition = no premium. The land sells at its fundamental value based on location and community.
                  </td>
                </tr>
                <tr style={{ background: 'rgba(39, 174, 96, 0.1)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>😌 Uncontested renewal</strong><br/>
                    <span style={{ color: '#7f8c8d', fontSize: '11px' }}>No challenger can afford it</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#27ae60' }}>
                    Defender keeps lot
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    Market value
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Even without competition, leases reset to current market value. Prevents locking in outdated prices as neighborhoods change.
                    <br/><em style={{ color: '#27ae60' }}>Example: You got a lot at 8 when the area was empty. Now it's worth 15. You pay 15 to renew.</em>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(231, 76, 60, 0.1)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>💪 Challenger is wealthier</strong><br/>
                    <span style={{ color: '#7f8c8d', fontSize: '11px' }}>Challenger wealth {'>'} Defender wealth</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#e74c3c' }}>
                    Challenger takes lot
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    Higher of:<br/>• Market value, or<br/>• Defender's wealth + 1
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    The challenger only needs to outbid the defender's maximum possible bid. But they always pay at least market value—no stealing undervalued land.
                    <br/><em style={{ color: '#27ae60' }}>Example: Market 15, Defender wealth 10. Challenger pays max(15, 11) = 15.</em>
                    <br/><em style={{ color: '#27ae60' }}>Example: Market 15, Defender wealth 20. Challenger pays max(15, 21) = 21.</em>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(52, 152, 219, 0.1)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>🤝 Equal wealth</strong><br/>
                    <span style={{ color: '#7f8c8d', fontSize: '11px' }}>Challenger wealth = Defender wealth</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#27ae60' }}>
                    Defender keeps lot
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    Challenger's wealth<br/>(= their own wealth)
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    Ties go to the incumbent—stability matters. But the defender had to "go all in" to match, so they pay their full wealth.
                    <br/><em style={{ color: '#27ae60' }}>Example: Both have wealth 18. Defender keeps lot but pays 18.</em>
                  </td>
                </tr>
                <tr style={{ background: 'rgba(39, 174, 96, 0.1)' }}>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    <strong>🛡️ Defender is wealthier</strong><br/>
                    <span style={{ color: '#7f8c8d', fontSize: '11px' }}>Challenger wealth {'<'} Defender wealth</span>
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#27ae60' }}>
                    Defender keeps lot
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#2c3e50' }}>
                    Higher of:<br/>• Market value, or<br/>• Challenger's wealth + 1
                  </td>
                  <td style={{ padding: '10px', borderBottom: '1px solid #e9ecef', color: '#7f8c8d', fontSize: '12px' }}>
                    The defender only needs to outbid the challenger. Competition still pushes price above market if the challenger is wealthy.
                    <br/><em style={{ color: '#27ae60' }}>Example: Market 15, Challenger wealth 12. Defender pays max(15, 13) = 15.</em>
                    <br/><em style={{ color: '#27ae60' }}>Example: Market 15, Challenger wealth 18. Defender pays max(15, 19) = 19.</em>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          {/* Insight box */}
          <div style={{ 
            background: 'rgba(100, 255, 218, 0.1)', 
            border: '1px solid rgba(100, 255, 218, 0.3)',
            borderRadius: '8px',
            padding: '14px',
            marginBottom: '16px',
          }}>
            <div style={{ color: '#27ae60', fontWeight: '600', marginBottom: '6px' }}>💡 Key Insight: Price Discovery</div>
            <div style={{ color: '#7f8c8d', fontSize: '13px', lineHeight: '1.5' }}>
              The auction system ensures prices reflect <em>both</em> fundamental land value <em>and</em> competitive demand. 
              Without challengers, prices track market value. With competition, prices rise—but only as high as needed to win. 
              This mimics real estate dynamics where desirable properties command premiums.
            </div>
          </div>
          
          {/* Design Philosophy box */}
          <div style={{ 
            background: 'rgba(243, 156, 18, 0.1)', 
            border: '1px solid rgba(243, 156, 18, 0.3)',
            borderRadius: '8px',
            padding: '14px',
          }}>
            <div style={{ color: '#f39c12', fontWeight: '600', marginBottom: '6px' }}>🎯 Design Philosophy</div>
            <div style={{ color: '#7f8c8d', fontSize: '13px', lineHeight: '1.5' }}>
              This simulation models a <strong style={{ color: '#2c3e50' }}>Georgist land value system</strong> where land cannot be permanently owned—only leased. 
              When leases expire, the market rediscovers the price through competitive auction. Land value flows from location (environment) 
              and community (neighbors), not from the occupant's improvements. The auction mechanism ensures efficient allocation while 
              the lease system prevents permanent speculation.
            </div>
          </div>
        </div>
      )}
      
      {/* Scenarios Tab */}
      {activeTab === 'scenarios' && (
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
        }}>
          <h2 style={{ color: '#f39c12', marginTop: 0, marginBottom: '24px', textAlign: 'center' }}>
            Experiment Scenarios
          </h2>
          <p style={{ color: '#7f8c8d', textAlign: 'center', marginBottom: '32px' }}>
            Each scenario configures the simulation to highlight different economic dynamics. 
            Click "Initialize" to reset the simulation with those settings.
          </p>
          
          <div style={{
            display: 'grid',
            gap: '16px',
          }}>
            {scenarios.map(scenario => (
              <div
                key={scenario.id}
                style={{
                  background: '#f8f9fa',
                  borderRadius: '12px',
                  padding: '24px',
                  border: '1px solid #e9ecef',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '300px' }}>
                    <h3 style={{ color: '#f39c12', margin: '0 0 8px 0' }}>{scenario.title}</h3>
                    <p style={{ color: '#7f8c8d', margin: '0 0 12px 0', lineHeight: '1.6' }}>
                      {scenario.description}
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px' }}>
                      <span style={{ color: '#27ae60' }}>
                        Immigration: <strong>{scenario.settings.immigrationRate}</strong>
                      </span>
                      <span style={{ color: '#27ae60' }}>
                        Lease: <strong>{scenario.settings.minLeaseLength}-{scenario.settings.maxLeaseLength}</strong>
                      </span>
                      <span style={{ color: '#27ae60' }}>
                        Max Wealth: <strong>{scenario.settings.maxWealth}</strong>
                      </span>
                      <span style={{ color: '#27ae60' }}>
                        Env: <strong>{scenario.settings.environmentMultiplier}x</strong>
                      </span>
                      <span style={{ color: '#27ae60' }}>
                        Community: <strong>{scenario.settings.communityMultiplier}x</strong>
                      </span>
                      <span style={{ color: scenario.settings.vacancyDecay ? '#27ae60' : '#e74c3c' }}>
                        Decay: <strong>{scenario.settings.vacancyDecay ? 'ON' : 'OFF'}</strong>
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => applyScenario(scenario)}
                    style={{
                      padding: '12px 24px',
                      borderRadius: '8px',
                      border: '1px solid #27ae60',
                      background: 'rgba(39, 174, 96, 0.2)',
                      color: '#27ae60',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '14px',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseOver={(e) => {
                      e.target.style.background = 'rgba(39, 174, 96, 0.4)';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.background = 'rgba(39, 174, 96, 0.2)';
                    }}
                  >
                    Initialize →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Simulation Tab */}
      {activeTab === 'simulation' && (
      <>
      {/* Shortcuts hint */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 16px',
        padding: '12px 16px',
        background: '#fafafa',
        borderRadius: '12px',
        border: '1px solid #f8f9fa',
        display: 'flex',
        justifyContent: 'center',
        gap: '24px',
        flexWrap: 'wrap',
        fontSize: '12px',
        color: '#7f8c8d',
      }}>
        <span><strong style={{ color: '#27ae60' }}>Shift+Click</strong> parcel for details</span>
        <span><strong style={{ color: '#27ae60' }}>Click</strong> agent to track</span>
        <span><strong style={{ color: '#27ae60' }}>⏮⏭</strong> time travel</span>
      </div>
      
      <div style={{
        display: 'flex',
        gap: '24px',
        maxWidth: '1200px',
        margin: '0 auto',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {/* Left Panel - Controls (Compact) */}
        <div style={{
          width: '220px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          {/* Round + Stats Row */}
          <div style={{
            display: 'flex',
            gap: '8px',
          }}>
            <div style={{
              background: '#f8f9fa',
              borderRadius: '8px',
              padding: '8px 12px',
              border: '1px solid #e9ecef',
              flex: 1,
            }}>
              <div style={{ fontSize: '10px', color: '#7f8c8d' }}>ROUND</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#27ae60' }}>{round}</div>
            </div>
            <div style={{
              background: '#f8f9fa',
              borderRadius: '8px',
              padding: '8px 12px',
              border: '1px solid #e9ecef',
              flex: 1,
            }}>
              <div style={{ fontSize: '10px', color: '#7f8c8d' }}>OCCUPIED</div>
              <div style={{ fontSize: '18px', fontWeight: '600' }}>{occupiedCount}<span style={{ fontSize: '12px', color: '#7f8c8d' }}>/100</span></div>
            </div>
          </div>
          
          {/* Controls Row */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={handleStepBack} disabled={history.length === 0 && historyIndex === -1}
              style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd', background: '#f8f9fa', color: '#7f8c8d', cursor: 'pointer', fontSize: '12px' }}>⏮</button>
            <button onClick={() => setIsPlaying(!isPlaying)}
              style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', background: isPlaying ? '#e74c3c' : '#27ae60', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>{isPlaying ? '⏸' : '▶'}</button>
            <button onClick={handleStepForward}
              style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd', background: '#f8f9fa', color: '#7f8c8d', cursor: 'pointer', fontSize: '12px' }}>⏭</button>
            <button onClick={handleReset}
              style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd', background: '#f8f9fa', color: '#7f8c8d', cursor: 'pointer', fontSize: '12px' }}>↺</button>
          </div>
          
          {/* Auto-run + Download Row */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => { setAutoRunTarget(50); setIsPlaying(true); }} disabled={isPlaying || round >= 50}
              style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(243, 156, 18, 0.3)', background: 'rgba(243, 156, 18, 0.1)', color: '#f39c12', fontWeight: '600', cursor: isPlaying || round >= 50 ? 'not-allowed' : 'pointer', fontSize: '10px', opacity: isPlaying || round >= 50 ? 0.5 : 1 }}>
              {autoRunTarget !== null ? '⏳...' : '⏩ R50'}
            </button>
            <button onClick={downloadCSV}
              style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(100, 255, 218, 0.3)', background: 'rgba(100, 255, 218, 0.1)', color: '#27ae60', fontWeight: '600', cursor: 'pointer', fontSize: '10px' }}>📥 CSV</button>
          </div>
          
          {/* Time travel indicator */}
          {historyIndex >= 0 && (
            <div style={{ background: 'rgba(231, 76, 60, 0.2)', borderRadius: '6px', padding: '4px 8px', border: '1px solid rgba(231, 76, 60, 0.3)', fontSize: '10px', color: '#e74c3c', textAlign: 'center' }}>
              ⏪ History ({historyIndex + 1}/{history.length})
            </div>
          )}
          
          {/* Parameters Box */}
          <div style={{
            background: '#f8f9fa',
            borderRadius: '8px',
            padding: '10px',
            border: '1px solid #e9ecef',
          }}>
            <div style={{ fontSize: '10px', color: '#7f8c8d', marginBottom: '8px', fontWeight: '600' }}>PARAMETERS</div>
            
            {/* Immigration */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: '#7f8c8d' }}>Immigration</span>
                <span style={{ fontSize: '12px', fontWeight: '600' }}>{immigrationRate}/rnd</span>
              </div>
              <input type="range" min="1" max="25" value={immigrationRate} onChange={(e) => setImmigrationRate(parseInt(e.target.value))}
                style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'linear-gradient(90deg, #3498db, #9b59b6)', appearance: 'none', cursor: 'pointer' }} />
            </div>
            
            {/* Lease Length */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: '#7f8c8d' }}>Lease</span>
                <span style={{ fontSize: '12px', fontWeight: '600' }}>{minLeaseLength}-{maxLeaseLength}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <input type="range" min="1" max="25" value={minLeaseLength} onChange={(e) => { const val = parseInt(e.target.value); setMinLeaseLength(val); if (val > maxLeaseLength) setMaxLeaseLength(val); }}
                  style={{ width: '100%', height: '4px', borderRadius: '2px', background: '#27ae60', appearance: 'none', cursor: 'pointer' }} />
                <input type="range" min="1" max="25" value={maxLeaseLength} onChange={(e) => { const val = parseInt(e.target.value); setMaxLeaseLength(val); if (val < minLeaseLength) setMinLeaseLength(val); }}
                  style={{ width: '100%', height: '4px', borderRadius: '2px', background: '#e74c3c', appearance: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            
            {/* Max Wealth */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: '#7f8c8d' }}>Max Wealth</span>
                <span style={{ fontSize: '12px', fontWeight: '600' }}>{maxWealth}</span>
              </div>
              <input type="range" min="20" max="50" value={maxWealth} onChange={(e) => setMaxWealth(parseInt(e.target.value))}
                style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'linear-gradient(90deg, #3498db, #2ecc71)', appearance: 'none', cursor: 'pointer' }} />
            </div>
            
            {/* Env + Community Weights */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '9px', color: '#7f8c8d' }}>Env</span>
                  <span style={{ fontSize: '11px', fontWeight: '600' }}>{environmentMultiplier.toFixed(1)}x</span>
                </div>
                <input type="range" min="0" max="2" step="0.1" value={environmentMultiplier} onChange={(e) => setEnvironmentMultiplier(parseFloat(e.target.value))}
                  style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'linear-gradient(90deg, #e74c3c, #f39c12)', appearance: 'none', cursor: 'pointer' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '9px', color: '#7f8c8d' }}>Community</span>
                  <span style={{ fontSize: '11px', fontWeight: '600' }}>{communityMultiplier.toFixed(1)}x</span>
                </div>
                <input type="range" min="0" max="2" step="0.1" value={communityMultiplier} onChange={(e) => setCommunityMultiplier(parseFloat(e.target.value))}
                  style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'linear-gradient(90deg, #9b59b6, #3498db)', appearance: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            
            {/* Vacancy Decay Toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={vacancyDecay} onChange={(e) => setVacancyDecay(e.target.checked)}
                style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
              <span style={{ fontSize: '10px', color: '#7f8c8d' }}>Vacancy Decay (-0.5/rnd)</span>
            </label>
          </div>
          
          {/* Quick Stats */}
          <div style={{
            background: '#f8f9fa',
            borderRadius: '8px',
            padding: '8px 10px',
            border: '1px solid #e9ecef',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
          }}>
            <span style={{ color: '#7f8c8d' }}>Open: <span style={{ color: '#27ae60', fontWeight: '600' }}>{100 - occupiedCount}</span></span>
            <span style={{ color: '#7f8c8d' }}>Unhoused: <span style={{ color: '#e74c3c', fontWeight: '600' }}>{unhoused.length}</span></span>
          </div>
          
          {/* Legend */}
          <div style={{
            background: '#f8f9fa',
            borderRadius: '8px',
            padding: '8px 10px',
            border: '1px solid #e9ecef',
          }}>
            <div style={{ fontSize: '10px', color: '#7f8c8d', marginBottom: '6px' }}>LEGEND</div>
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '9px', color: '#7f8c8d', marginBottom: '2px' }}>Land Value</div>
              <div style={{ height: '8px', borderRadius: '4px', background: 'linear-gradient(90deg, rgb(220,60,60), rgb(220,180,40), rgb(200,220,60), rgb(70,190,120))' }} />
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#7f8c8d', marginBottom: '2px' }}>Agent Wealth</div>
              <div style={{ height: '8px', borderRadius: '4px', background: 'linear-gradient(90deg, hsl(210,70%,80%), hsl(210,70%,30%))' }} />
            </div>
          </div>
        </div>
        
        {/* Center - Grid and Parcel Info */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          {/* Grid */}
          <div style={{
            background: '#f0f0f0',
            borderRadius: '16px',
            padding: '16px',
            border: '1px solid #e9ecef',
          }}>
          {/* Column labels */}
          <div style={{
            display: 'flex',
            marginBottom: '4px',
            paddingLeft: '24px',
          }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{
                width: '52px',
                textAlign: 'center',
                fontSize: '10px',
                color: '#7f8c8d',
              }}>
                ENV: {i + 1}
              </div>
            ))}
          </div>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(10, 52px)',
            gap: '2px',
          }}>
            {parcels.map((parcel, index) => {
              const desirability = getCurrentValue(parcel);
              const isSelectedParcel = selectedParcel && selectedParcel.id === parcel.id;
              return (
                <div
                  key={parcel.id}
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '6px',
                    background: getParcelColor(desirability),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'background 0.3s ease',
                    boxShadow: isSelectedParcel 
                      ? '0 0 0 3px #f39c12, inset 0 0 10px rgba(0,0,0,0.2)' 
                      : 'inset 0 0 10px rgba(0,0,0,0.2)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey || !parcel.occupant) {
                      // Shift+click or click empty parcel = select parcel
                      setSelectedParcel(parcel);
                      setSelectedAgent(null);
                    } else {
                      // Regular click on occupied = select agent
                      setSelectedAgent(parcel.occupant);
                      setSelectedParcel(null);
                    }
                  }}
                >
                  {/* Desirability score */}
                  <div style={{
                    fontSize: '14px',
                    fontWeight: '700',
                    color: 'white',
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    zIndex: 1,
                  }}>
                    {desirability.toFixed(desirability % 1 === 0 ? 0 : 1)}
                  </div>
                  
                  {/* Agent dot */}
                  {parcel.occupant && parcel.occupant.id && (() => {
                    const isSelected = selectedAgent && selectedAgent.id && selectedAgent.id === parcel.occupant.id;
                    // Debug: log when we find a match
                    if (isSelected) {
                      console.log('MATCH FOUND:', {
                        parcelId: parcel.id,
                        parcelRow: parcel.row,
                        parcelCol: parcel.col,
                        occupantId: parcel.occupant.id,
                        selectedAgentId: selectedAgent.id,
                        areEqual: selectedAgent.id === parcel.occupant.id,
                        typeOfOccupantId: typeof parcel.occupant.id,
                        typeOfSelectedId: typeof selectedAgent.id,
                      });
                    }
                    return (
                      <div style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: getAgentColor(parcel.occupant.wealth),
                        border: isSelected 
                          ? '2px solid #e74c3c' 
                          : '2px solid #fff',
                        boxShadow: isSelected
                          ? '0 0 8px #e74c3c'
                          : '0 2px 4px #f0f0f0',
                        marginTop: '2px',
                      }} />
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
        
          {/* Selected Parcel Info - Below Grid */}
          {selectedParcel && liveParcelData && (
            <div style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid #f39c12',
              position: 'relative',
              width: '540px',
            }}>
              <button
                onClick={() => setSelectedParcel(null)}
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#7f8c8d',
                  cursor: 'pointer',
                  fontSize: '18px',
                }}
              >
                ×
              </button>
              <div style={{ fontSize: '14px', color: '#f39c12', marginBottom: '16px', fontWeight: '600' }}>
                PARCEL INFO (Row {Math.floor(liveParcelData.id / 10) + 1}, Col {(liveParcelData.id % 10) + 1})
              </div>
              
              {/* Value Breakdown */}
              <div style={{
                background: '#f8f9fa',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '10px', color: '#7f8c8d', marginBottom: '10px', fontWeight: '600' }}>VALUE BREAKDOWN</div>
                <div style={{ fontSize: '14px', color: '#2c3e50', marginBottom: '6px' }}>
                  Environment: <span style={{ fontWeight: '700' }}>{liveParcelData.environmentScore}</span>
                  {environmentMultiplier !== 1 && (
                    <span style={{ color: '#7f8c8d' }}> × {environmentMultiplier.toFixed(1)} = <span style={{ color: '#2c3e50', fontWeight: '700' }}>{(liveParcelData.environmentScore * environmentMultiplier).toFixed(1)}</span></span>
                  )}
                </div>
                <div style={{ fontSize: '14px', color: '#2c3e50', marginBottom: '6px' }}>
                  Community: <span style={{ fontWeight: '700' }}>{liveParcelData.communityScore.toFixed(1)}</span>
                  {communityMultiplier !== 1 && (
                    <span style={{ color: '#7f8c8d' }}> × {communityMultiplier.toFixed(1)} = <span style={{ color: '#2c3e50', fontWeight: '700' }}>{(liveParcelData.communityScore * communityMultiplier).toFixed(1)}</span></span>
                  )}
                </div>
                {(() => {
                  const envValue = liveParcelData.environmentScore * environmentMultiplier;
                  const commValue = liveParcelData.communityScore * communityMultiplier;
                  const baseValue = envValue + commValue;
                  const decayedValue = vacancyDecay && liveParcelData.roundsVacant > 0 
                    ? Math.max(envValue, baseValue - (liveParcelData.roundsVacant * 0.5))
                    : baseValue;
                  const hasDecay = vacancyDecay && liveParcelData.roundsVacant > 0;
                  return (
                    <div style={{ fontSize: '13px', color: '#7f8c8d', marginBottom: '10px' }}>
                      Market Value: <span style={{ fontWeight: '600', color: hasDecay ? '#e74c3c' : '#2c3e50' }}>{decayedValue.toFixed(1)}</span>
                      {hasDecay && <span style={{ fontSize: '11px' }}> (base {baseValue.toFixed(1)})</span>}
                    </div>
                  );
                })()}
                
                {/* Lease Price - prominent display */}
                {liveParcelData.leasePrice && (() => {
                  const marketValue = (liveParcelData.environmentScore * environmentMultiplier) + (liveParcelData.communityScore * communityMultiplier);
                  const diff = liveParcelData.leasePrice - marketValue;
                  return (
                    <div style={{ 
                      fontSize: '18px', 
                      fontWeight: '700',
                      color: '#27ae60',
                      marginTop: '8px',
                    }}>
                      Lease Price: {liveParcelData.leasePrice}
                      <span style={{ 
                        fontSize: '12px', 
                        color: diff > 0 ? '#e67e22' : '#27ae60',
                        marginLeft: '8px',
                      }}>
                        ({diff > 0 ? '+' : ''}{diff.toFixed(1)} {diff < 0 ? 'below market' : 'above market'})
                      </span>
                    </div>
                  );
                })()}
                
                {!liveParcelData.leasePrice && (
                  <div style={{ fontSize: '16px', color: '#e74c3c', fontWeight: '700', marginTop: '8px' }}>
                    Vacant
                    {liveParcelData.roundsVacant > 0 && (
                      <span style={{ fontSize: '12px', color: '#7f8c8d', marginLeft: '8px' }}>
                        ({liveParcelData.roundsVacant} rounds)
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Current Occupant */}
              {liveParcelData.occupant && (
                <div style={{
                  background: 'rgba(39, 174, 96, 0.15)',
                  borderRadius: '8px',
                  padding: '14px',
                  marginBottom: '12px',
                }}>
                  <div style={{ fontSize: '10px', color: '#27ae60', marginBottom: '10px', fontWeight: '600' }}>
                    CURRENT OCCUPANT
                  </div>
                  <div style={{ fontSize: '14px', color: '#2c3e50', marginBottom: '6px' }}>
                    Wealth: <span style={{ fontWeight: '700' }}>{liveParcelData.occupant.wealth}</span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#2c3e50' }}>
                    Lease: Rounds {liveParcelData.occupant.leaseStart} - {liveParcelData.occupant.leaseStart + liveParcelData.occupant.leaseLength}
                  </div>
                </div>
              )}
              
              {/* History */}
              <div style={{
                background: '#f8f9fa',
                borderRadius: '8px',
                padding: '14px',
              }}>
                <div style={{ fontSize: '10px', color: '#7f8c8d', marginBottom: '10px', fontWeight: '600' }}>
                  HISTORY ({(liveParcelData.history || []).length} events)
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  {(liveParcelData.history || []).slice().reverse().map((event, idx) => {
                    const d = event.details || {};
                    return (
                      <div key={idx} style={{
                        background: '#f0f0f0',
                        borderRadius: '6px',
                        padding: '12px',
                        marginBottom: '10px',
                      }}>
                        <div style={{ 
                          color: event.type === 'auction_won' ? '#27ae60' : 
                                 event.type === 'lease_expired' ? '#e74c3c' :
                                 event.type === 'priced_out' ? '#e67e22' : '#27ae60',
                          fontWeight: '700',
                          fontSize: '13px',
                          marginBottom: '8px',
                        }}>
                          Round {event.round}: {event.type.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        
                        {/* Auction Won Details */}
                        {event.type === 'auction_won' && (
                          <div style={{ fontSize: '12px', color: '#7f8c8d', lineHeight: '1.6' }}>
                            <div>Agent (wealth {d.agent?.wealth}) won auction</div>
                            {d.type === 'challenger_wins' && d.defender && (
                              <div>Outbid defender (wealth {d.defender.wealth})</div>
                            )}
                            {d.type === 'defender_wins' && d.challenger && (
                              <div>Defended against challenger (wealth {d.challenger.wealth})</div>
                            )}
                            {d.type === 'defender_wins_tie' && d.challenger && (
                              <div>Tied with challenger (wealth {d.challenger.wealth}), defender wins</div>
                            )}
                            <div>Lease Price: {d.leasePrice}</div>
                            <div>Market Value: {d.currentValue?.toFixed(1)}</div>
                            <div>Lease: {d.leaseLength} rounds</div>
                          </div>
                        )}
                        
                        {/* Occupied (uncontested) Details */}
                        {event.type === 'occupied' && (
                          <div style={{ fontSize: '12px', color: '#7f8c8d', lineHeight: '1.6' }}>
                            <div>Agent (wealth {d.agent?.wealth}) {d.type === 'vacant_claim' ? 'claimed vacant lot' : 'renewed uncontested'}</div>
                            <div>Lease Price: {d.leasePrice}</div>
                            <div>Market Value: {d.currentValue?.toFixed(1)}</div>
                            <div>Lease: {d.leaseLength} rounds</div>
                          </div>
                        )}
                        
                        {/* Lease Expired Details */}
                        {event.type === 'lease_expired' && (
                          <div style={{ fontSize: '12px', color: '#7f8c8d', lineHeight: '1.6' }}>
                            <div>Agent (wealth {d.agent?.wealth}) lease ended</div>
                            <div>Was here: Rounds {d.leaseStart} - {d.leaseStart + d.leaseLength}</div>
                            <div>Paid: {d.leasePrice} | Now worth: {d.currentValue?.toFixed(1)}</div>
                          </div>
                        )}
                        
                        {/* Priced Out Details */}
                        {event.type === 'priced_out' && (
                          <div style={{ fontSize: '12px', color: '#7f8c8d', lineHeight: '1.6' }}>
                            <div>Agent (wealth {d.agent?.wealth}) priced out</div>
                            <div>Market value: {d.currentValue?.toFixed(1)}</div>
                            <div style={{ color: '#e67e22' }}>{d.reason}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(!liveParcelData.history || liveParcelData.history.length === 0) && (
                    <div style={{ color: '#7f8c8d', fontSize: '12px', fontStyle: 'italic' }}>
                      No history yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Right Panel - Unhoused */}
        <div style={{
          width: '240px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <div style={{
            background: '#f8f9fa',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid #e9ecef',
            flex: 1,
            maxHeight: '500px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              fontSize: '12px',
              color: '#7f8c8d',
              marginBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>UNHOUSED AGENTS</span>
              <span style={{
                background: '#e74c3c',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: '600',
              }}>
                {unhoused.length}
              </span>
            </div>
            
            <div style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              alignContent: 'flex-start',
              padding: '8px 0',
            }}>
              {unhoused.map((agent, idx) => (
                <div
                  key={`${agent.id}-${idx}`}
                  onClick={() => setSelectedAgent(agent)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: getAgentColor(agent.wealth),
                    border: selectedAgent && selectedAgent.id === agent.id
                      ? '2px solid #e74c3c'
                      : '2px solid #aaa',
                    boxShadow: selectedAgent && selectedAgent.id === agent.id
                      ? '0 0 8px #e74c3c'
                      : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.1s',
                  }}
                  onMouseOver={(e) => e.target.style.transform = 'scale(1.2)'}
                  onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                />
              ))}
              {unhoused.length === 0 && (
                <div style={{
                  color: '#7f8c8d',
                  fontSize: '12px',
                  textAlign: 'center',
                  width: '100%',
                  padding: '20px 0',
                }}>
                  No unhoused agents yet
                </div>
              )}
            </div>
          </div>
          
          {/* Selected Agent Info */}
          {selectedAgent && liveAgentData && (
            <div style={{
              background: '#f8f9fa',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid #e74c3c',
              position: 'relative',
            }}>
              <button
                onClick={() => setSelectedAgent(null)}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#7f8c8d',
                  cursor: 'pointer',
                  fontSize: '16px',
                }}
              >
                ×
              </button>
              <div style={{ fontSize: '12px', color: '#e74c3c', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                TRACKING AGENT
                <span style={{
                  background: liveAgentData.status === 'housed' ? '#27ae60' : '#e74c3c',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: '600',
                }}>
                  {liveAgentData.status === 'housed' ? 'HOUSED' : 'UNHOUSED'}
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: getAgentColor(liveAgentData.agent.wealth),
                  border: '3px solid #e74c3c',
                  boxShadow: '0 0 8px #e74c3c',
                }} />
                <div>
                  <div style={{ fontSize: '11px', color: '#7f8c8d' }}>Wealth</div>
                  <div style={{ fontSize: '20px', fontWeight: '700' }}>{liveAgentData.agent.wealth}</div>
                </div>
              </div>
              <div style={{
                fontSize: '13px',
                color: '#7f8c8d',
                marginBottom: '6px',
              }}>
                Entered: <span style={{ color: '#2c3e50', fontWeight: '600' }}>Round {liveAgentData.agent.roundEntered}</span>
              </div>
              <div style={{
                fontSize: '10px',
                color: '#555',
                marginBottom: '6px',
                wordBreak: 'break-all',
              }}>
                ID: {liveAgentData.agent.id}
              </div>
              {liveAgentData.status === 'housed' && liveAgentData.agent.leaseLength && (
                <>
                  <div style={{
                    fontSize: '13px',
                    color: '#7f8c8d',
                    marginBottom: '6px',
                  }}>
                    Lease started: <span style={{ color: '#2c3e50', fontWeight: '600' }}>Round {liveAgentData.agent.leaseStart}</span>
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#7f8c8d',
                    marginBottom: '6px',
                  }}>
                    Lease length: <span style={{ color: '#2c3e50', fontWeight: '600' }}>{liveAgentData.agent.leaseLength} rounds</span>
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#7f8c8d',
                  }}>
                    Expires: <span style={{ color: '#e67e22', fontWeight: '600' }}>Round {liveAgentData.agent.leaseStart + liveAgentData.agent.leaseLength}</span>
                  </div>
                </>
              )}
              {liveAgentData.status === 'unhoused' && (
                <div style={{
                  fontSize: '13px',
                  color: '#e74c3c',
                  fontStyle: 'italic',
                }}>
                  Searching for affordable land...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
};

export default GeorgistLandValueSimulation;
