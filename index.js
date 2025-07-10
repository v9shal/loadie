const express=require('express');
const app=express();

app.get('/health',(req,res)=>{
  res.status(200).json("healthy");
})


app.get('/api',(req,res)=>{
  res.json({message:'hello from backend',server:'locahost:3001'});
})

app.listen(3002,()=>{
  console.log('app listening on port 3002~');
})