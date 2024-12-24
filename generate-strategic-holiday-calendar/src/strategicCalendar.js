import React, { useState, useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  Grid2,
  Alert,
  Menu,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Checkbox,
  Select as MuiSelect,
  CircularProgress
} from "@mui/material";
import { Upload, Calendar, Download, ChevronDown } from "lucide-react";
import * as XLSX from "xlsx";

// Add ICS generation utility function
const generateICS = (recommendations) => {
  const events = recommendations.flatMap((rec) => {
    return rec.dates.map((date) => {
      // Format date to YYYYMMDD
      const formatDate = (d) => {
        return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      return `BEGIN:VEVENT
DTSTART:${formatDate(date)}
DTEND:${formatDate(new Date(date.getTime() + 24 * 60 * 60 * 1000))}
SUMMARY:Strategic Leave - ${rec.title}
DESCRIPTION:${rec.strategy}
STATUS:TENTATIVE
SEQUENCE:0
CATEGORIES:${rec.color || "None"} // Added color category
RRULE:${rec.recurring ? `FREQ=${rec.recurring};BYMONTH=${date.getMonth() + 1};BYDAY=${date.getDate()}` : ''} // Added support for recurring events
BEGIN:VALARM
TRIGGER:-PT1H
DESCRIPTION:Reminder for ${rec.title}
ACTION:DISPLAY
END:VALARM
END:VEVENT`;
    });
  });

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Holiday Planner//Strategic Leave Calendar//EN
CALSCALE:GREGORIAN
${events.join('\n')}
END:VCALENDAR`;
};

const HolidayPlanner = () => {
  const [holidays, setHolidays] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [view, setView] = useState("month"); // 'month' or 'year'
  const [filterType, setFilterType] = useState("all"); // 'all', 'longWeekend', 'bridge', 'cluster'
  const [anchorEl, setAnchorEl] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [eventDetailsDialogOpen, setEventDetailsDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [color, setColor] = useState(''); // Added color state
  const [recurring, setRecurring] = useState(''); // Modified recurring state to handle multiple options
  const [reminderTime, setReminderTime] = useState(1); // Reminder time in days
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const recurrenceOptions = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

  const handleMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
    setIsMenuOpen(true);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setIsMenuOpen(false);
  };

  // Add export functions for calendar formats
  const exportCalendar = useCallback((format) => {
    const calendar = generateICS(recommendations);
    const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `strategic-leaves.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [recommendations]);

  // Parse XLS file
  const parseXLS = useCallback((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    return data
      .map((row) => {
        // Handle Excel date number format
        let date;
        if (row.Date) {
          const excelDate = row.Date;
          if (!isNaN(excelDate)) {
            // Convert Excel date number to JS date
            date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
          } else {
            // Try parsing as string
            date = new Date(excelDate);
          }
        }
        const holiday = row.Holiday || row.holiday;
        return { date, name: holiday };
      })
      .filter((holiday) => holiday.date && !isNaN(holiday.date.getTime()));
  }, []);

  // Analyze holidays
  const analyzeHolidays = useCallback((holidayList) => {
    const recommendations = [];
    const sortedHolidays = [...holidayList].sort((a, b) => a.date - b.date);
    
    sortedHolidays.forEach((holiday, index) => {
      const dayOfWeek = holiday.date.getDay();
      
      // Long weekend opportunities
      if (dayOfWeek === 2) { // Tuesday
        recommendations.push({
          type: 'Long Weekend',
          title: 'Extended Weekend Opportunity',
          strategy: `Take Monday off to create a 4-day weekend with ${holiday.name}`,
          dates: [
            new Date(holiday.date.getTime() - 86400000),
            holiday.date
          ],
          holiday: holiday.name,
          daysNeeded: 1,
          efficiency: 4/1 // 4 days off for 1 leave day
        });
      } else if (dayOfWeek === 4) { // Thursday
        recommendations.push({
          type: 'Long Weekend',
          title: 'Extended Weekend Opportunity',
          strategy: `Take Friday off to create a 4-day weekend with ${holiday.name}`,
          dates: [
            holiday.date,
            new Date(holiday.date.getTime() + 86400000)
          ],
          holiday: holiday.name,
          daysNeeded: 1,
          efficiency: 4/1
        });
      }
      
      // Bridge days analysis
      if (index < sortedHolidays.length - 1) {
        const nextHoliday = sortedHolidays[index + 1];
        const daysBetween = Math.floor((nextHoliday.date - holiday.date) / 86400000) - 1;
        
        if (daysBetween > 0 && daysBetween <= 4) {
          const bridgeDays = [];
          for (let i = 1; i <= daysBetween; i++) {
            bridgeDays.push(new Date(holiday.date.getTime() + i * 86400000));
          }
          
          recommendations.push({
            type: 'Bridge',
            title: 'Bridge Days Opportunity',
            strategy: `Take ${daysBetween} day${daysBetween > 1 ? 's' : ''} between ${holiday.name} and ${nextHoliday.name} for an extended break`,
            dates: [holiday.date, ...bridgeDays, nextHoliday.date],
            daysNeeded: daysBetween,
            efficiency: (daysBetween + 2)/daysBetween
          });
        }
      }
      
      // Cluster analysis (looking ahead 14 days for multiple holidays)
      const nextTwoWeeks = sortedHolidays.filter(h => 
        h.date > holiday.date && 
        (h.date - holiday.date) <= 1209600000 // 14 days in milliseconds
      );
      
      if (nextTwoWeeks.length >= 2) {
        const clusterDays = new Set();
        nextTwoWeeks.forEach(h => {
          for (let i = -1; i <= 1; i++) {
            clusterDays.add(new Date(h.date.getTime() + i * 86400000).toISOString().split('T')[0]);
          }
        });
        
        if (clusterDays.size >= 4) {
          recommendations.push({
            type: 'Cluster',
            title: 'Holiday Cluster Found',
            strategy: `Multiple holidays found within 2 weeks. Consider taking strategic leave days to maximize time off`,
            dates: [holiday.date, ...nextTwoWeeks.map(h => h.date)],
            daysNeeded: clusterDays.size - nextTwoWeeks.length - 1,
            efficiency: clusterDays.size/(clusterDays.size - nextTwoWeeks.length - 1)
          });
        }
      }
    });
    
    return recommendations.sort((a, b) => b.efficiency - a.efficiency);
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(
    async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = (e) => reject(e);
          reader.readAsArrayBuffer(file);
        });
        
        const parsedHolidays = parseXLS(buffer);
        if (!parsedHolidays.length) {
          throw new Error("No valid holiday data found in file");
        }
        
        setHolidays(parsedHolidays);
        const newRecommendations = analyzeHolidays(parsedHolidays);
        setRecommendations(newRecommendations);
        
        // Update selected year and month based on first holiday
        if (parsedHolidays[0]?.date) {
          setSelectedYear(parsedHolidays[0].date.getFullYear());
          setSelectedMonth(parsedHolidays[0].date.getMonth());
        }
      } catch (err) {
        console.error("File processing error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [parseXLS, analyzeHolidays]
  );
  
  // Get calendar days
  // const getCalendarDays = useCallback(() => {
  //   if (!selectedYear || !selectedMonth) {
  //     return [[]]; // Return empty week to prevent mapping errors
  //   }

  //   const firstDay = new Date(selectedYear, selectedMonth, 1);
  //   const lastDay = new Date(selectedYear, selectedMonth + 1, 0);
  //   const days = [];
    
  //   const startDay = firstDay.getDay();
    
  //   // Add empty cells for days before the 1st
  //   for (let i = 0; i < startDay; i++) {
  //     days.push({
  //       date: null,
  //       isHoliday: false,
  //       holidayName: '',
  //       isWeekend: false
  //     });
  //   }
    
  //   // Add all days of the month
  //   for (let date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
  //     const currentDate = new Date(date);
      
  //     const holiday = holidays.find(h => 
  //       h.date && 
  //       h.date.getDate() === currentDate.getDate() && 
  //       h.date.getMonth() === currentDate.getMonth() &&
  //       h.date.getFullYear() === currentDate.getFullYear()
  //     );
      
  //     days.push({
  //       date: currentDate,
  //       isHoliday: !!holiday,
  //       holidayName: holiday?.name || '',
  //       isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6
  //     });
  //   }
    
  //   // Fill remaining days to complete the last week
  //   const remainingDays = 7 - (days.length % 7);
  //   if (remainingDays < 7) {
  //     for (let i = 0; i < remainingDays; i++) {
  //       days.push({
  //         date: null,
  //         isHoliday: false,
  //         holidayName: '',
  //         isWeekend: false
  //       });
  //     }
  //   }
    
  //   // Group into weeks
  //   const weeks = [];
  //   for (let i = 0; i < days.length; i += 7) {
  //     weeks.push(days.slice(i, i + 7));
  //   }
    
  //   return weeks;
  // }, [selectedMonth, selectedYear, holidays]);

  const getCalendarDays = useCallback(() => {
    if (!selectedYear || !selectedMonth) {
      return [[]];
    }
  
    const firstDay = new Date(selectedYear, selectedMonth, 1);
    const lastDay = new Date(selectedYear, selectedMonth + 1, 0);
    const days = [];
    
    // Get the first day of the week (0-6)
    const firstDayOfWeek = firstDay.getDay();
    
    // Add placeholder days for previous month
    const prevMonthLastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(selectedYear, selectedMonth - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
        isHoliday: false,
        holidayName: '',
        isWeekend: false
      });
    }
    
    // Add days for current month
    for (let date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
      const currentDate = new Date(date);
      const holiday = holidays.find(h => 
        h.date && 
        h.date.getDate() === currentDate.getDate() && 
        h.date.getMonth() === currentDate.getMonth() &&
        h.date.getFullYear() === currentDate.getFullYear()
      );
      
      const dayOfWeek = currentDate.getDay();
      days.push({
        date: currentDate,
        isCurrentMonth: true,
        isHoliday: !!holiday,
        holidayName: holiday?.name || '',
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6
      });
    }
    
    // Add placeholder days for next month
    const remainingDays = 35 - days.length; // 5 rows * 7 days = 35
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(selectedYear, selectedMonth + 1, i),
        isCurrentMonth: false,
        isHoliday: false,
        holidayName: '',
        isWeekend: false
      });
    }
    
    // Group into weeks
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    
    return weeks;
  }, [selectedMonth, selectedYear, holidays]);
  
  // Export recommendations
  const exportRecommendations = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      recommendations.map((rec) => ({
        Type: rec.title,
        Strategy: rec.strategy,
        "Days Needed": rec.daysNeeded,
        "Efficiency Score": rec.efficiency.toFixed(2),
        Dates: rec.dates.map((d) => d.toLocaleDateString()).join(", "),
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, "Leave Recommendations");
    XLSX.writeFile(wb, "leave-recommendations.xlsx");
  }, [recommendations]);

  // Render UI
  return (
    <Box sx={{ p: 4, maxWidth: "1200px", mx: "auto" }}>
      <Card>
        <CardHeader title="Holiday Planner" />
        <CardContent>
          <Grid2 container spacing={2}>
            <Grid2 item>
              <Button
                variant="contained"
                component="label"
                startIcon={<Upload size={16} />}
              >
                Upload XLS
                {loading && <CircularProgress size={20} sx={{ ml: 1 }} />} {/* Loading indicator */}
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  hidden
                  onChange={handleFileUpload}
                />
              </Button>
            </Grid2>
            <Grid2 item>
              <Button
                variant="outlined"
                startIcon={<Calendar size={16} />}
                onClick={() => setView(view === "month" ? "year" : "month")}
              >
                {view === "month" ? "Show Year" : "Show Month"}
              </Button>
            </Grid2>
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>} {/* Error message */}
            <Grid2 item>
              <Button
                onClick={handleMenuOpen}
                variant="outlined"
                disabled={recommendations.length === 0}
                endIcon={<ChevronDown />}
                startIcon={<Download />}
              >
                Export
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={isMenuOpen}
                onClose={handleMenuClose}
                PaperProps={{
                  style: {
                    width: '200px',
                  },
                }}
              >
                <MenuItem
                  onClick={() => {
                    exportRecommendations();
                    handleMenuClose();
                  }}
                >
                  Export as Excel (.xlsx)
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    exportCalendar('ics');
                    handleMenuClose();
                  }}
                >
                  Export as iCalendar (.ics)
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    exportCalendar('ical');
                    handleMenuClose();
                  }}
                >
                  Export as iCal (.ical)
                </MenuItem>
              </Menu>
            </Grid2>
            <Grid2 item>
              <FormControl>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <InputLabel sx={{ marginBottom: 5 }}>Filter</InputLabel>
                  <Select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    sx={{ minWidth: 150 }}
                  >
                    <MenuItem value="all">All Recommendations</MenuItem>
                    <MenuItem value="longWeekend">Long Weekends</MenuItem>
                    <MenuItem value="bridge">Bridge Days</MenuItem>
                    <MenuItem value="cluster">Holiday Clusters</MenuItem>
                  </Select>
                </Box>
              </FormControl>
            </Grid2>
          </Grid2>
        </CardContent>
      </Card>
      <Card>
        <CardHeader
          title="Calendar View"
          action={
            <FormControl variant="outlined" size="small">
              <InputLabel>Month</InputLabel>
              <Select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                label="Month"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <MenuItem key={i} value={i}>
                    {new Date(2024, i, 1).toLocaleString('default', { month: 'long' })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          }
        />
        <CardContent>
          <Grid2 container spacing={2} sx={{ width: '100%', mb: 2 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <Grid2 key={day} xs={12 / 7}>
                <Box sx={{ 
                  textAlign: 'center',
                  minWidth: '138px',
                  py: 1,
                  backgroundColor: 'black.100',
                  borderRadius: 2
                }}>
                  <Typography variant="subtitle2" fontWeight="bold">
                    {day}
                  </Typography>
                </Box>
              </Grid2>
            ))}
          </Grid2>

          {getCalendarDays().map((week, weekIndex) => (
            <Grid2 container spacing={2} key={weekIndex} sx={{ mb: 2 }}>
              {week.map((day, dayIndex) => (
                <Grid2 key={`${weekIndex}-${dayIndex}`} xs={12 / 7}>
                  {day.date ? (
                    <Box
                    sx={{
                      minHeight: '75px',
                      minWidth: '120px',
                      p: 1,
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      backgroundColor: day.isHoliday
                        ? 'primary.lighter'
                        : day.isWeekend && day.isCurrentMonth
                        ? 'grey.50'
                        : day.isCurrentMonth
                        ? 'white'
                        : 'grey.100',
                      opacity: day.isCurrentMonth ? 1 : 0.5,
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'all 0.2s',
                      '&:hover': {
                        boxShadow: 1,
                        bgcolor: day.isHoliday 
                          ? 'primary.light'
                          : 'grey.100'
                      }
                    }}
                  >
                    <Typography 
                      variant="body1" 
                      fontWeight={day.isHoliday ? 'bold' : 'normal'}
                      sx={{ 
                        mb: 0.5,
                        color: day.isCurrentMonth ? 'text.primary' : 'text.secondary'
                      }}
                      
                    >
                      {day.date.getDate()}
                    </Typography>
                    {day.holidayName && (
                      <Typography 
                        variant="caption" 
                        color="primary"
                        sx={{ 
                          wordBreak: 'break-word',
                          textWrap: 'wrap',
                          lineHeight: 1.2 
                        }}
                      >
                        {day.holidayName}
                      </Typography>
                    )}
                  </Box>
                  ) : (
                    <Box sx={{ 
                      minHeight: '80px',
                      backgroundColor: 'grey.50',
                      borderRadius: 1
                    }} />
                  )}
                </Grid2>
              ))}
            </Grid2>
          ))}
        </CardContent>
      </Card>

      {/* Strategic Leave Recommendations */}
      <Card sx={{ mt: 4 }}>
        <CardHeader title="Strategic Leave Recommendations" />
        <CardContent>
          {recommendations.length > 0 ? (
            recommendations.map((rec, index) => (
              <Alert key={index} severity="info" sx={{ mb: 2, backgroundColor: rec.color }}>
                <Typography variant="h6">{rec.title}</Typography>
                <Typography>{rec.strategy}</Typography>
                <Typography>
                  Dates: {rec.dates.map((d) => d.toLocaleDateString()).join(", ")}
                </Typography>
              </Alert>
            ))
          ) : (
            <Typography>No recommendations available.</Typography>
          )}
        </CardContent>
      </Card>

      {/* Holiday Summary */}
      {/* <Card sx={{ mt: 4 }}>
        <CardHeader title="Holiday Summary" />
        <CardContent>
          <Grid2 container spacing={4}>
            <Grid2 item xs={6}>
              <Typography variant="h6" gutterBottom>Official Holidays</Typography>
              {holidays.sort((a, b) => a.date - b.date).map((holiday, index) => (
                <Typography key={index} sx={{ mb: 1 }}>
                  {holiday.date.toLocaleDateString()}: {holiday.name}
                </Typography>
              ))}
            </Grid2>
            <Grid2 item xs={6}>
              <Typography variant="h6" gutterBottom>Suggested Leave Days</Typography>
              {recommendations.map((rec, index) => (
                <Typography key={index} sx={{ mb: 1 }}>
                  {rec.dates.map(d => d.toLocaleDateString()).join(', ')}
                  <br />
                  <Typography variant="caption" color="textSecondary">
                    ({rec.type}: {rec.daysNeeded} day{rec.daysNeeded > 1 ? 's' : ''} needed)
                  </Typography>
                </Typography>
              ))}
            </Grid2>
          </Grid2>
        </CardContent>
      </Card> */}
      <Card sx={{ mt: 4 }}>
  <CardHeader title="Holiday Summary" />
  <CardContent>
    <Grid2 container spacing={6}> {/* Increased spacing to create more space */}
      {/* Official Holidays Section */}
      <Grid2 item xs={6}>
        <Typography variant="h6" gutterBottom>
          Official Holidays
        </Typography>
        {holidays
          .sort((a, b) => a.date - b.date)
          .map((holiday, index) => (
            <Box key={index} sx={{ mb: 2 }}>
              <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                {holiday.date.toLocaleDateString()}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {holiday.name}
              </Typography>
            </Box>
          ))}
      </Grid2>

      {/* Suggested Leave Days Section */}
      <Grid2 item xs={6} sx={{ mt: { xs: 2, sm: 0 } }}> {/* Adds extra space on smaller screens */}
        <Typography variant="h6" gutterBottom>
          Suggested Leave Days
        </Typography>
        {recommendations.map((rec, index) => (
          <Box key={index} sx={{ mb: 2 }}>
            <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
              {rec.dates.map((d) => d.toLocaleDateString()).join(', ')}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              ({rec.type}: {rec.daysNeeded} day
              {rec.daysNeeded > 1 ? 's' : ''} needed)
            </Typography>
          </Box>
        ))}
      </Grid2>
    </Grid2>
  </CardContent>
</Card>


      
      {/* Event Details Dialog */}
      <Dialog
        open={eventDetailsDialogOpen}
        onClose={() => setEventDetailsDialogOpen(false)}
      >
        <DialogTitle>Event Details</DialogTitle>
        <DialogContent>
          <Typography variant="body1">{selectedEvent?.description}</Typography>
          <TextField
            label="Event Color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            fullWidth
            margin="normal"
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Recurrence</InputLabel>
            <MuiSelect
              value={recurring}
              onChange={(e) => setRecurring(e.target.value)}
              label="Recurrence"
            >
              {recurrenceOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </MuiSelect>
          </FormControl>
          <FormControlLabel
            control={
              <Checkbox
                checked={reminderTime === 1}
                onChange={() => setReminderTime(1)}
              />
            }
            label="Set Reminder"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setEventDetailsDialogOpen(false)}
            color="primary"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default HolidayPlanner;
